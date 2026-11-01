import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import type { Coordinate, Stop, TransitAlertSnapshot } from '../domain/types';
import { transitAlertWarnings } from '../domain/transit-alert-freshness';
import { composeBoard } from '../transit-data/board';
import type { StopBoard } from '../transit-data/board-model';
import { epochMs, indexFeed, type RealtimeSnapshot, type RTFeed } from '../transit-data/realtime';
import type { TimetableReader } from '../transit-data/reader';
import { timetableService } from '../transit-data/runtime';
import { adoptCatalog, catalogStop, catalogStopRoutes, catalogStops } from '../transit-data/stop-catalog';
import { distanceMeters } from './geo';
import { checkAbort, fetchResponse, requestQueue, ServiceError } from './network';
import { diagnostics } from './diagnostics';
export type { RTFeed } from '../transit-data/realtime';

const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
const GTT = 'https://percorsieorari.gtt.to.it/das_gtfsrt/';
const queue = requestQueue(1500);
/** Arrival boards poll the shared citywide feed at this cadence, only while a board is visible. */
export const ARRIVALS_REFRESH_MS = 30_000;
const SOURCE = 'GTT S.p.A. – Gruppo Torinese Trasporti';

export function getNearbyStops(center: Coordinate, options: { limit?: number; radiusMeters?: number } = {}): Stop[] {
  return catalogStops().map(stop => ({ ...stop, distanceMeters: distanceMeters(center, stop.coordinate) }))
    .filter(s => s.distanceMeters <= (options.radiusMeters ?? 1800)).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, options.limit ?? 18);
}
export function getStop(stopId: string): Stop | undefined { return catalogStop(stopId); }

interface FeedSnapshot { readonly feed: RTFeed; readonly fetchedAt: number }
const cache = new Map<string, FeedSnapshot>();
/** One citywide retrieval per interval, shared by every consumer; the selected stop is never sent. */
async function fetchFeed(file: string, maxAge: number, signal?: AbortSignal): Promise<FeedSnapshot> {
  checkAbort(signal); const stored = cache.get(file); const now = Date.now();
  if (stored && now >= stored.fetchedAt && now - stored.fetchedAt < maxAge) return stored;
  return queue(async () => {
    const current = cache.get(file); const now = Date.now();
    if (current && now >= current.fetchedAt && now - current.fetchedAt < maxAge) return current;
    const provider = file === 'trip_update.aspx' ? 'gtt-arrivals' : file === 'alerts.aspx' ? 'gtt-alerts' : 'other';
    const response = await fetchResponse(`${GTT}${file}`, { signal }, provider);
    try {
      const decoded = Feed.decode(new Uint8Array(await response.arrayBuffer()));
      checkAbort(signal);
      const feed = Feed.toObject(decoded, { longs: Number, enums: String }) as RTFeed;
      if (!feed.header?.gtfsRealtimeVersion) throw new Error('missing feed header');
      if (feed.header.incrementality === 'DIFFERENTIAL') throw new Error('unsupported differential feed');
      // Protobuf omits an empty repeated field; an empty FULL_DATASET is a valid no-predictions snapshot.
      feed.entity ??= [];
      const snapshot = Object.freeze({ feed, fetchedAt: Date.now() });
      cache.set(file, snapshot); return snapshot;
    } catch {
      checkAbort(signal);
      diagnostics.record({ type: 'service', state: 'invalid', provider });
      throw new ServiceError('GTT ha restituito un feed non valido. Nessuna previsione inventata.', 'invalid');
    }
  }, signal);
}

interface Joined { snapshot: RealtimeSnapshot; matched: Map<string, Promise<number>> }
const joined = new WeakMap<FeedSnapshot, Joined>();
/** Index the feed once, and count feed-wide trip joins once per installed package. */
async function realtimeFor(feed: FeedSnapshot, reader: TimetableReader): Promise<{ snapshot: RealtimeSnapshot; matchedTrips: number }> {
  let entry = joined.get(feed);
  if (!entry) joined.set(feed, entry = { snapshot: indexFeed(feed.feed, feed.fetchedAt), matched: new Map() });
  const { snapshot } = entry;
  let matched = entry.matched.get(reader.meta.packageHash);
  if (!matched) {
    matched = reader.trips([...snapshot.byTrip.keys()]).then(trips => {
      const count = [...snapshot.byTrip].reduce((sum, [tripId, updates]) => sum + (trips.has(tripId) ? updates.length : 0), 0);
      const unmatched = snapshot.tripUpdates - count;
      // Unmatched counts are diagnostics, not board content.
      if (snapshot.tripUpdates && !count) diagnostics.record({ type: 'timetable', state: 'realtime-unmatched', count: unmatched });
      else if (unmatched) diagnostics.record({ type: 'timetable', state: 'realtime-partial', count: unmatched });
      return count;
    });
    entry.matched.set(reader.meta.packageHash, matched);
  }
  return { snapshot, matchedTrips: await matched };
}

async function activeReader(stopId: string): Promise<TimetableReader> {
  let dataset;
  try { dataset = await timetableService.current(); } catch { throw new ServiceError('Orari GTT non disponibili sul dispositivo.', 'unavailable'); }
  void adoptCatalog(dataset.reader).catch(() => undefined);
  if (!stopId || !await dataset.reader.stop(stopId)) throw new ServiceError('Fermata non presente nel pacchetto orari installato.', 'invalid');
  return dataset.reader;
}

/** Realtime failed: the error carries the scheduled board so the UI keeps rows while the refresh backs off. */
export class RealtimeUnavailableError extends ServiceError {
  constructor(message: string, readonly board: StopBoard, kind: ServiceError['kind']) { super(message, kind); this.name = 'RealtimeUnavailableError'; }
}

/** Local scheduled rows only: no network, rendered immediately. */
export async function getScheduledBoard(stopId: string, options: { signal?: AbortSignal; now?: number } = {}): Promise<StopBoard> {
  const reader = await activeReader(stopId);
  checkAbort(options.signal);
  return composeBoard(reader, stopId, options.now ?? Date.now(), { refresh: timetableService.status().refresh });
}

/** Scheduled rows refined by the shared citywide TripUpdates feed. */
export async function getStopBoard(stopId: string, options: { signal?: AbortSignal } = {}): Promise<StopBoard> {
  const reader = await activeReader(stopId);
  let feed: FeedSnapshot;
  try { feed = await fetchFeed('trip_update.aspx', ARRIVALS_REFRESH_MS - 5_000, options.signal); } catch (error) {
    checkAbort(options.signal);
    const message = error instanceof Error ? error.message : 'Tempo reale non disponibile.';
    const board = await composeBoard(reader, stopId, Date.now(), { refresh: timetableService.status().refresh, realtime: { error: message } });
    throw new RealtimeUnavailableError(message, board, error instanceof ServiceError ? error.kind : 'network');
  }
  checkAbort(options.signal);
  const realtime = await realtimeFor(feed, reader);
  const board = await composeBoard(reader, stopId, Date.now(), { refresh: timetableService.status().refresh, realtime, nextRefreshAt: feed.fetchedAt + ARRIVALS_REFRESH_MS });
  // A nonempty feed with zero joins means the installed package is older than GTT's trip IDs.
  if (board.realtime.state === 'unmatched') void timetableService.check('mismatch');
  return board;
}

function text(value?: { translation?: { text?: string; language?: string }[] }): string { return value?.translation?.find(t => t.language === 'it')?.text ?? value?.translation?.[0]?.text ?? ''; }
export async function getTransitAlerts(stopId?: string, options: { signal?: AbortSignal } = {}): Promise<TransitAlertSnapshot> {
  const stop = stopId === undefined ? undefined : getStop(stopId);
  if (stopId !== undefined && !stop) throw new ServiceError('Fermata non presente nel pacchetto installato.', 'invalid');
  const { feed, fetchedAt } = await fetchFeed('alerts.aspx', 5 * 60_000, options.signal); const now = Date.now();
  checkAbort(options.signal);
  const sourceUpdatedAt = epochMs(feed.header?.timestamp);
  const warnings = transitAlertWarnings(sourceUpdatedAt, now);
  const routeIds = stopId ? new Set(catalogStopRoutes(stopId)) : undefined;
  const alerts = (feed.entity ?? []).flatMap(entity => {
    const alert = entity.alert; if (!alert || entity.isDeleted) return [];
    if (alert.activePeriod?.length && !alert.activePeriod.some(p => (!epochMs(p.start) || epochMs(p.start)! <= now) && (!epochMs(p.end) || epochMs(p.end)! >= now))) return [];
    if (stopId && alert.informedEntity?.length && !alert.informedEntity.some(e => e.stopId === stopId || (!e.stopId && (!e.routeId || routeIds?.has(e.routeId))))) return [];
    return [{ id: entity.id ?? text(alert.headerText), title: text(alert.headerText), description: text(alert.descriptionText), url: text(alert.url) || undefined, source: SOURCE }];
  }).slice(0, 30);
  return { alerts, fetchedAt, sourceUpdatedAt, source: SOURCE, warnings };
}
