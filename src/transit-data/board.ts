import type { TransitRealtimeState, TransitTimeBasis } from '../domain/types';
import { GTT_ATTRIBUTION, GTT_URL, LABELS, LIVE_MAX_AGE_MS, modeForRouteType, type BoardNotice, type GttBoardRow, type GttRealtimeDetail, type RealtimeSummary, type StopBoard } from './board-model';
import { predictEvent, updateForEvent, type Prediction, type RealtimeSnapshot } from './realtime';
import type { TimetableReader } from './reader';
import { scheduleNotices, type RefreshState } from './refresh-policy';
import { DEFAULT_WINDOW, scheduledEvents, scheduledSeconds, type BoardWindow, type ScheduledEvent } from './scheduled-board';

export const BOARD_LIMIT = 40;
export const SOURCES_URL = 'https://www.gtt.to.it/gtt_gtfs_license.html';

export interface RealtimeInput {
  snapshot?: RealtimeSnapshot;
  /** Feed-wide joins against the installed package: zero joins on a nonempty feed means a stale package. */
  matchedTrips?: number;
  error?: string;
}

const parseTime = (value?: string | null) => { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : undefined; };

const NEUTRAL: Record<GttRealtimeDetail, { state: TransitRealtimeState; basis: TransitTimeBasis }> = {
  fresh: { state: 'realtime-with-source-time', basis: 'predicted' },
  stale: { state: 'unknown', basis: 'predicted' },
  'no-trip-update': { state: 'scheduled', basis: 'scheduled' },
  'no-data': { state: 'scheduled', basis: 'scheduled' },
  'not-provided': { state: 'scheduled', basis: 'scheduled' },
  cancelled: { state: 'cancelled', basis: 'scheduled' },
  skipped: { state: 'cancelled', basis: 'scheduled' },
  unavailable: { state: 'unknown', basis: 'scheduled' },
  unverifiable: { state: 'unknown', basis: 'scheduled' },
  expired: { state: 'unknown', basis: 'scheduled' },
  'before-first-update': { state: 'unknown', basis: 'scheduled' },
};

function toRow(event: ScheduledEvent, prediction: Prediction, context: {
  stop: { id: string; name: string }; line: string; mode: GttBoardRow['mode']; operator?: string; feedVersion: string;
  retrievedAt: number; scheduleUpdatedAt?: number;
}): GttBoardRow {
  const detail = prediction.state;
  const predicted = detail === 'fresh' || detail === 'stale';
  // An arrival-only prediction is presented as an arrival, with the scheduled arrival beside it.
  const event_ = predicted && prediction.predictedEvent === 'arrival' ? 'arrival' : 'departure';
  const scheduledAt = event.scheduledAt === undefined ? undefined
    : event_ === 'arrival' ? event.origin + scheduledSeconds(event, event.position, 'arrival') * 1000 : event.scheduledAt;
  const neutral = NEUTRAL[detail];
  const note = detail === 'not-provided' ? LABELS.metroScheduledOnly
    : detail === 'before-first-update' ? 'Il mezzo potrebbe essere già transitato: previsioni disponibili solo per le fermate successive.' : undefined;
  return {
    id: `gtt:${event.trip.tripId}:${event.serviceDate}:${event.position}:${event.start}`,
    provider: 'gtt',
    upstream: { ...(context.operator ? { operator: context.operator } : {}), attribution: GTT_ATTRIBUTION, dataset: `gtt_gtfs.zip ${context.feedVersion}` },
    event: event_, mode: context.mode, line: context.line,
    ...(event.trip.headsign ? { headsign: event.trip.headsign } : {}),
    stop: context.stop,
    ...(scheduledAt !== undefined ? { scheduledAt } : {}),
    ...(detail === 'fresh' ? { predictedAt: prediction.predictedAt } : detail === 'stale' ? { providerTimeAt: prediction.predictedAt } : {}),
    timeBasis: predicted && prediction.propagated ? 'propagated' : neutral.basis,
    realtimeState: neutral.state,
    tripCancelled: detail === 'cancelled',
    tripRef: `gtt:${event.trip.tripId}:${event.serviceDate}`,
    retrievedAt: context.retrievedAt,
    // Only the provider's own feed/entity timestamps; never the retrieval time.
    ...((predicted || detail === 'cancelled' || detail === 'skipped') && prediction.updatedAt !== undefined ? { sourceUpdatedAt: prediction.updatedAt } : {}),
    gtt: {
      routeId: event.trip.routeId, tripId: event.trip.tripId, serviceDate: event.serviceDate, realtime: detail,
      ...(predicted ? { delaySeconds: prediction.delaySeconds, ...(prediction.propagated ? { propagated: true } : {}) } : {}),
      ...(event.frequency ? { frequency: { ...event.frequency } } : {}),
      ...(context.scheduleUpdatedAt !== undefined ? { scheduleUpdatedAt: context.scheduleUpdatedAt } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/**
 * Scheduled-first board: every row comes from the installed timetable; realtime only refines
 * rows joined by exact trip_id and service date. Unmatched feed counts stay out of the rows.
 */
export async function composeBoard(reader: TimetableReader, stopId: string, now: number, options: {
  refresh: RefreshState; realtime?: RealtimeInput; window?: BoardWindow; limit?: number; nextRefreshAt?: number;
}): Promise<StopBoard> {
  const { meta } = reader;
  const manifest = meta.manifest;
  const [scheduled, routes, agencies, stopInfo] = await Promise.all([
    scheduledEvents(reader, stopId, now, options.window ?? DEFAULT_WINDOW), reader.routes(), reader.agencies(), reader.stop(stopId),
  ]);
  const realtime = options.realtime;
  const snapshot = realtime?.snapshot;
  const tripUpdates = snapshot?.tripUpdates ?? 0;
  const matchedTrips = realtime?.matchedTrips ?? 0;
  const summary: RealtimeSummary = !realtime ? { state: 'not-requested', tripUpdates: 0, matchedTrips: 0, unmatchedTrips: 0 }
    : !snapshot ? { state: 'unavailable', tripUpdates: 0, matchedTrips: 0, unmatchedTrips: 0, ...(realtime.error ? { error: realtime.error } : {}) }
    : { state: tripUpdates > 0 && matchedTrips === 0 ? 'unmatched' : 'ok', feedUpdatedAt: snapshot.feedUpdatedAt, retrievedAt: snapshot.retrievedAt, tripUpdates, matchedTrips, unmatchedTrips: tripUpdates - matchedTrips };
  const joinable = summary.state === 'ok';
  const scheduleUpdatedAt = parseTime(manifest.source_last_modified);
  const confirmedAt = Math.max(parseTime(manifest.upstream_checked_at) ?? 0, options.refresh.confirmedAt ?? 0);
  const retrievedAt = snapshot?.retrievedAt ?? now;
  const stop = { id: stopId, name: stopInfo?.name ?? stopId };

  const rows: (GttBoardRow & { sortAt: number })[] = [];
  for (const event of scheduled.events) {
    const route = routes.get(event.trip.routeId);
    const mode = modeForRouteType(route?.routeType);
    const update = joinable && snapshot ? updateForEvent(snapshot, event) : undefined;
    let prediction: Prediction = joinable && snapshot ? predictEvent(event, update, snapshot.feedUpdatedAt, now)
      : { state: summary.state === 'not-requested' ? 'no-trip-update' : 'unavailable' };
    // GTT publishes no metro TripUpdates; a matched update would still be used if one appears.
    if (mode === 'metro' && !update) prediction = { state: 'not-provided' };
    const row = toRow(event, prediction, {
      stop, line: route?.shortName || event.trip.routeId, mode, operator: route ? agencies.get(route.agencyId) : undefined,
      feedVersion: meta.feedVersion, retrievedAt, scheduleUpdatedAt,
    });
    const predictedTime = row.predictedAt ?? row.providerTimeAt;
    const sortAt = predictedTime ?? row.scheduledAt ?? Math.max(now, event.frequency!.from);
    // A vehicle whose scheduled (or predicted) time has passed is not shown as upcoming.
    if (sortAt < now - 60_000) continue;
    rows.push({ ...row, sortAt });
  }
  rows.sort((a, b) => a.sortAt - b.sortAt || (a.line ?? '').localeCompare(b.line ?? ''));

  const notices: BoardNotice[] = scheduleNotices(meta, options.refresh, now);
  if (summary.state === 'unmatched') notices.push({ code: 'realtime-unmatched', text: LABELS.unmatched, action: 'update-schedules' });
  else if (summary.state === 'unavailable') notices.push({ code: 'realtime-unavailable', text: `Tempo reale GTT non disponibile: mostrati gli orari programmati.${realtime?.error ? ` ${realtime.error}` : ''}` });
  else if (summary.state === 'ok' && (summary.feedUpdatedAt === undefined || now - summary.feedUpdatedAt > LIVE_MAX_AGE_MS)) notices.push({ code: 'realtime-feed-stale', text: 'Il feed tempo reale GTT non è aggiornato: le previsioni sono mostrate con la loro età.' });

  return {
    provider: 'gtt', event: 'departure',
    stop: { ...stop, ...(stopInfo ? { coordinate: { latitude: stopInfo.lat, longitude: stopInfo.lon } } : {}) },
    rows: rows.slice(0, options.limit ?? BOARD_LIMIT).map(({ sortAt: _sortAt, ...row }) => row),
    retrievedAt, nextRefreshAt: options.nextRefreshAt ?? retrievedAt,
    attributions: [`${GTT_ATTRIBUTION} (${GTT_URL})`], sourcesUrl: SOURCES_URL,
    warnings: notices.map(notice => notice.text),
    generatedAt: now,
    schedule: {
      packageHash: meta.packageHash, feedVersion: meta.feedVersion, validFrom: meta.validFrom, validTo: meta.validTo,
      packageSource: meta.source, coverage: scheduled.coverage,
      ...(scheduleUpdatedAt !== undefined ? { sourceUpdatedAt: scheduleUpdatedAt } : {}),
      ...(confirmedAt ? { upstreamCheckedAt: confirmedAt } : {}),
      ...(parseTime(manifest.built_at) !== undefined ? { builtAt: parseTime(manifest.built_at) } : {}),
    },
    realtime: summary, notices,
  };
}
