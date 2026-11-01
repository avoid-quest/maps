import { LIVE_MAX_AGE_MS, STALE_MAX_AGE_MS, type GttRealtimeDetail } from './board-model';
import { scheduledSeconds, type ScheduledEvent } from './scheduled-board';

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
  propagated?: boolean;
  updatedAt?: number;
}

const PLAUSIBLE_SHIFT_S = 6 * 3600;
type Kind = 'arrival' | 'departure';
/** Predicted epoch ms for one StopTimeEvent, or undefined when it carries no usable value (missing delay is not zero). */
function eventValue(event: ScheduledEvent, position: number, kind: Kind, value: EventTime | undefined): { at: number; delay: number } | undefined {
  if (!value) return undefined;
  const scheduled = event.origin + scheduledSeconds(event, position, kind) * 1000;
  const time = epochMs(value.time);
  if (time !== undefined && Math.abs(time - scheduled) <= PLAUSIBLE_SHIFT_S * 1000) return { at: time, delay: Math.round((time - scheduled) / 1000) };
  if (typeof value.delay === 'number' && Number.isFinite(value.delay) && Math.abs(value.delay) <= PLAUSIBLE_SHIFT_S) return { at: scheduled + value.delay * 1000, delay: value.delay };
  return undefined;
}

/**
 * GTFS-RT semantics for one scheduled stop event:
 * - a matching StopTimeUpdate wins: departure value, else arrival value (presented as an arrival);
 * - otherwise the nearest earlier update's delay propagates downstream, across SKIPPED stops,
 *   but never across NO_DATA and never upstream;
 * - freshness requires both feed and entity timestamps; stale values keep their age.
 */
export function predictEvent(event: ScheduledEvent, update: TripUpdate | undefined, feedUpdatedAt: number | undefined, now: number): Prediction {
  if (!update) return { state: 'no-trip-update' };
  const entityAt = epochMs(update.timestamp);
  if (feedUpdatedAt === undefined || entityAt === undefined || feedUpdatedAt > now + 60_000 || entityAt > now + 60_000) return { state: 'unverifiable' };
  const updatedAt = Math.min(feedUpdatedAt, entityAt);
  const age = now - updatedAt;
  if (age > STALE_MAX_AGE_MS) return { state: 'expired', updatedAt };
  const fresh: 'fresh' | 'stale' = age > LIVE_MAX_AGE_MS ? 'stale' : 'fresh';
  if (update.trip?.scheduleRelationship === 'CANCELED') return { state: 'cancelled', updatedAt };

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
    if (exact.scheduleRelationship === 'SKIPPED') return { state: 'skipped', updatedAt };
    if (exact.scheduleRelationship === 'NO_DATA') return { state: 'no-data' };
    const departure = eventValue(event, position, 'departure', exact.departure);
    if (departure) return { state: fresh, predictedAt: departure.at, predictedEvent: 'departure', delaySeconds: departure.delay, updatedAt };
    const arrival = eventValue(event, position, 'arrival', exact.arrival);
    if (arrival) return { state: fresh, predictedAt: arrival.at, predictedEvent: 'arrival', delaySeconds: arrival.delay, updatedAt };
    // An event without time or delay is not "on time": a missing delay is never zero.
    return { state: 'unverifiable' };
  }
  for (let index = resolved.length - 1; index >= 0; index--) {
    const { position: upstream, update: stopUpdate } = resolved[index]!;
    if (upstream > position) continue;
    if (stopUpdate.scheduleRelationship === 'SKIPPED') continue;
    if (stopUpdate.scheduleRelationship === 'NO_DATA') return { state: 'no-data' };
    const kind: Kind | undefined = eventValue(event, upstream, 'departure', stopUpdate.departure) ? 'departure' : eventValue(event, upstream, 'arrival', stopUpdate.arrival) ? 'arrival' : undefined;
    if (!kind) return { state: 'unverifiable' };
    const { delay } = eventValue(event, upstream, kind, stopUpdate[kind])!;
    const at = event.origin + (scheduledSeconds(event, position, kind) + delay) * 1000;
    return { state: fresh, predictedAt: at, predictedEvent: kind, delaySeconds: delay, propagated: true, updatedAt };
  }
  // Updates exist only for later stops (or none resolve): the vehicle may already have passed here.
  return { state: resolved.length ? 'before-first-update' : 'unverifiable' };
}
