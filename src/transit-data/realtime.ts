import { LIVE_MAX_AGE_MS, STALE_MAX_AGE_MS, type GttRealtimeDetail } from './board-model';
import { MAX_REALTIME_SHIFT_S, scheduledSeconds, type ScheduledEvent } from './scheduled-board';

interface EventTime { time?: number | string; delay?: number; uncertainty?: number }
export interface StopTimeUpdate { stopSequence?: number; stopId?: string; scheduleRelationship?: string; arrival?: EventTime; departure?: EventTime }
export interface TripUpdate {
  timestamp?: number | string; delay?: number;
  trip?: { tripId?: string; routeId?: string; startDate?: string; startTime?: string; scheduleRelationship?: string };
  stopTimeUpdate?: StopTimeUpdate[];
}
interface Translation { translation?: { text?: string; language?: string }[] }
export interface RTAlert { headerText?: Translation; descriptionText?: Translation; url?: Translation; activePeriod?: { start?: number | string; end?: number | string }[]; informedEntity?: { stopId?: string; routeId?: string }[] }
export interface RTFeed {
  header?: { gtfsRealtimeVersion?: string; timestamp?: number | string; incrementality?: string };
  entity?: { id?: string; isDeleted?: boolean; tripUpdate?: TripUpdate; alert?: RTAlert }[];
}

export function epochMs(time?: number | string): number | undefined {
  const value = Number(time); return Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
}

/** One citywide feed retrieval, indexed by trip_id once and shared by every board. */
export interface RealtimeSnapshot {
  feedUpdatedAt?: number;
  retrievedAt: number;
  byTrip: Map<string, TripUpdate[]>;
  tripUpdates: number;
}
export function indexFeed(feed: RTFeed, retrievedAt: number): RealtimeSnapshot {
  const byTrip = new Map<string, TripUpdate[]>(); let tripUpdates = 0;
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate; const tripId = update?.trip?.tripId;
    if (!update || !tripId || entity.isDeleted) continue;
    tripUpdates++;
    const list = byTrip.get(tripId) ?? []; list.push(update); byTrip.set(tripId, list);
  }
  return { feedUpdatedAt: epochMs(feed.header?.timestamp), retrievedAt, byTrip, tripUpdates };
}

const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':');

/** Exact trip_id plus service date (and start time when supplied) — never route or headsign guesses. */
export function updateForEvent(snapshot: RealtimeSnapshot, event: Pick<ScheduledEvent, 'trip' | 'serviceDate' | 'start'>): TripUpdate | undefined {
  const candidates = snapshot.byTrip.get(event.trip.tripId)?.filter(update => {
    const descriptor = update.trip ?? {};
    if (descriptor.startDate && descriptor.startDate !== event.serviceDate) return false;
    if (descriptor.startTime && descriptor.startTime !== clock(event.start)) return false;
    return true;
  }) ?? [];
  // Without a start date an update could belong to another service day: accept only an unambiguous one.
  return candidates.length === 1 ? candidates[0] : undefined;
}

export interface Prediction {
  state: GttRealtimeDetail;
  predictedAt?: number;
  predictedEvent?: 'arrival' | 'departure';
  delaySeconds?: number;
  /** StopTimeEvent.uncertainty in seconds, when the provider supplies it (0 = certain). */
  uncertaintySeconds?: number;
  propagated?: boolean;
  /** A cancellation or skipped stop reported for this event, kept with its age even when no longer current. */
  report?: 'cancelled' | 'skipped';
  updatedAt?: number;
}

type Kind = 'arrival' | 'departure';
interface Value { at: number; delay?: number; uncertainty?: number }
/**
 * Predicted epoch ms for one StopTimeEvent, or undefined when it carries no usable value (a missing
 * delay is not zero). Inexact frequency instances only accept absolute times: their template offsets
 * are not a schedule, so delay arithmetic against them would fabricate precision.
 */
function eventValue(event: ScheduledEvent, position: number, kind: Kind, value: EventTime | undefined): Value | undefined {
  if (!value) return undefined;
  const template = event.origin + scheduledSeconds(event, position, kind) * 1000;
  const uncertainty = typeof value.uncertainty === 'number' && Number.isFinite(value.uncertainty) && value.uncertainty >= 0 ? value.uncertainty : undefined;
  const time = epochMs(value.time);
  if (time !== undefined && Math.abs(time - template) <= MAX_REALTIME_SHIFT_S * 1000) {
    return { at: time, ...(event.inexact ? {} : { delay: Math.round((time - template) / 1000) }), ...(uncertainty !== undefined ? { uncertainty } : {}) };
  }
  if (event.inexact) return undefined;
  if (typeof value.delay === 'number' && Number.isFinite(value.delay) && Math.abs(value.delay) <= MAX_REALTIME_SHIFT_S) {
    return { at: template + value.delay * 1000, delay: value.delay, ...(uncertainty !== undefined ? { uncertainty } : {}) };
  }
  return undefined;
}

type Interpretation =
  | { kind: 'cancelled' | 'skipped' }
  | { kind: 'prediction'; at: number; event: Kind; delay?: number; uncertainty?: number; propagated?: boolean }
  | { kind: 'no-data' | 'unverifiable' | 'before-first-update' };

/** What the TripUpdate says about this stop event, before any freshness decision. */
function interpret(event: ScheduledEvent, update: TripUpdate): Interpretation {
  if (update.trip?.scheduleRelationship === 'CANCELED') return { kind: 'cancelled' };
  const { pattern, position } = event;
  const bySequence = new Map(pattern.sequences.map((sequence, index) => [sequence, index]));
  const resolved: { position: number; update: StopTimeUpdate }[] = [];
  for (const stopUpdate of update.stopTimeUpdate ?? []) {
    let at: number | undefined;
    if (stopUpdate.stopSequence !== undefined) at = bySequence.get(stopUpdate.stopSequence);
    else if (stopUpdate.stopId) {
      const first = pattern.stopIds.indexOf(stopUpdate.stopId);
      // A stop visited twice cannot be resolved from stop_id alone.
      if (first >= 0 && pattern.stopIds.indexOf(stopUpdate.stopId, first + 1) < 0) at = first;
    }
    if (at === undefined) continue;
    if (stopUpdate.stopId && pattern.stopIds[at] !== stopUpdate.stopId) continue;
    resolved.push({ position: at, update: stopUpdate });
  }
  resolved.sort((a, b) => a.position - b.position);

  const exact = resolved.find(entry => entry.position === position)?.update;
  if (exact) {
    if (exact.scheduleRelationship === 'SKIPPED') return { kind: 'skipped' };
    if (exact.scheduleRelationship === 'NO_DATA') return { kind: 'no-data' };
    const departure = eventValue(event, position, 'departure', exact.departure);
    if (departure) return { kind: 'prediction', at: departure.at, event: 'departure', delay: departure.delay, uncertainty: departure.uncertainty };
    const arrival = eventValue(event, position, 'arrival', exact.arrival);
    if (arrival) return { kind: 'prediction', at: arrival.at, event: 'arrival', delay: arrival.delay, uncertainty: arrival.uncertainty };
    // An event without time or delay is not "on time": a missing delay is never zero.
    return { kind: 'unverifiable' };
  }
  // Inexact frequency instances have no schedule to carry a delay along.
  if (event.inexact) return { kind: 'unverifiable' };
  for (let index = resolved.length - 1; index >= 0; index--) {
    const { position: upstream, update: stopUpdate } = resolved[index]!;
    if (upstream > position) continue;
    if (stopUpdate.scheduleRelationship === 'SKIPPED') continue;
    if (stopUpdate.scheduleRelationship === 'NO_DATA') return { kind: 'no-data' };
    const kind: Kind | undefined = eventValue(event, upstream, 'departure', stopUpdate.departure) ? 'departure' : eventValue(event, upstream, 'arrival', stopUpdate.arrival) ? 'arrival' : undefined;
    if (!kind) return { kind: 'unverifiable' };
    const source = eventValue(event, upstream, kind, stopUpdate[kind])!;
    const at = event.origin + (scheduledSeconds(event, position, kind) + source.delay!) * 1000;
    return { kind: 'prediction', at, event: kind, delay: source.delay, uncertainty: source.uncertainty, propagated: true };
  }
  // Updates exist only for later stops (or none resolve): the vehicle may already have passed here.
  return { kind: resolved.length ? 'before-first-update' : 'unverifiable' };
}

/**
 * GTFS-RT semantics for one scheduled stop event:
 * - a matching StopTimeUpdate wins: departure value, else arrival value (presented as an arrival);
 * - otherwise the nearest earlier update's delay propagates downstream, across SKIPPED stops,
 *   but never across NO_DATA and never upstream;
 * - freshness requires both feed and entity timestamps and applies equally to predictions,
 *   cancellations and skipped stops: definite up to 2 minutes, then reported with their age,
 *   and after 30 minutes no longer current (the report is kept with its age).
 */
export function predictEvent(event: ScheduledEvent, update: TripUpdate | undefined, feedUpdatedAt: number | undefined, now: number): Prediction {
  if (!update) return { state: 'no-trip-update' };
  const entityAt = epochMs(update.timestamp);
  if (feedUpdatedAt === undefined || entityAt === undefined || feedUpdatedAt > now + 60_000 || entityAt > now + 60_000) return { state: 'unverifiable' };
  const updatedAt = Math.min(feedUpdatedAt, entityAt);
  const age = now - updatedAt;
  const freshness = age > STALE_MAX_AGE_MS ? 'expired' : age > LIVE_MAX_AGE_MS ? 'stale' : 'fresh';
  const meaning = interpret(event, update);
  if (meaning.kind === 'cancelled' || meaning.kind === 'skipped') {
    return { state: freshness === 'fresh' ? meaning.kind : freshness, report: meaning.kind, updatedAt };
  }
  if (meaning.kind !== 'prediction') return { state: meaning.kind };
  if (freshness === 'expired') return { state: 'expired', updatedAt };
  return {
    state: freshness, predictedAt: meaning.at, predictedEvent: meaning.event, updatedAt,
    ...(meaning.delay !== undefined ? { delaySeconds: meaning.delay } : {}),
    ...(meaning.uncertainty !== undefined ? { uncertaintySeconds: meaning.uncertainty } : {}),
    ...(meaning.propagated ? { propagated: true } : {}),
  };
}

/** Parse a GTFS-RT start_time ("25:10:00" allowed) into seconds. */
export function startSeconds(value: string | undefined): number | undefined {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value ?? '');
  return match ? +match[1]! * 3600 + +match[2]! * 60 + +match[3]! : undefined;
}

/**
 * Instances of inexact frequency service named by realtime descriptors (trip_id, start_date,
 * start_time inside the frequency period). The headway row stays as the fallback.
 */
export function frequencyInstances(snapshot: RealtimeSnapshot, event: ScheduledEvent): ScheduledEvent[] {
  if (!event.frequency) return [];
  const { startSeconds: from, endSeconds: to } = event.frequency;
  const starts = new Set<number>();
  for (const update of snapshot.byTrip.get(event.trip.tripId) ?? []) {
    if (update.trip?.startDate && update.trip.startDate !== event.serviceDate) continue;
    const start = startSeconds(update.trip?.startTime);
    if (start !== undefined && start >= from && start < to) starts.add(start);
  }
  return [...starts].sort((a, b) => a - b).map(start => {
    const { frequency: _frequency, scheduledAt: _scheduledAt, ...rest } = event;
    return { ...rest, start, inexact: true };
  });
}
