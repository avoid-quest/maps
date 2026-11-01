import { identityKey, type PatternInfo, type TimetableReader, type TripIdentity, type TripInfo } from './reader';
import { startSeconds, type RealtimeSnapshot, type TripUpdate } from './realtime';
import type { RemapStore } from './remap';
import { activeServiceIds } from './calendar';

/**
 * Joins every TripUpdate of a feed to the installed timetable once per feed and package:
 * 1. by trip_id (fast path);
 * 2. otherwise, when a remap knows the live trip_id, by schedule identity — route, direction,
 *    shape and the descriptor's start_time — on the descriptor's start_date, requiring that GTT's
 *    current calendar runs the remapped service on that date, that exactly one local schedule
 *    (or several identical ones) matches, and that every reported stop_sequence (and stop_id)
 *    exists in the matched local pattern. Anything ambiguous or inconsistent is not joined.
 */
export interface JoinedUpdate { update: TripUpdate; via: 'trip_id' | 'identity' }
export interface FeedJoin {
  /** Updates per local trip_id. */
  byLocalTrip: Map<string, JoinedUpdate[]>;
  /** Identity joins whose local trip does not run on that date in the local calendar. */
  extensions: { trip: TripInfo; serviceDate: string }[];
  matchedTrips: number;
  identityMatched: number;
  /** Live trip_ids known neither to the package nor to the remap: a remap refresh may help. */
  unknownTrips: number;
  rejected: { ambiguous: number; mismatch: number; noSchedule: number };
}

export async function joinFeed(snapshot: RealtimeSnapshot, reader: TimetableReader, remap?: RemapStore): Promise<FeedJoin> {
  const byLocalTrip = new Map<string, JoinedUpdate[]>();
  const add = (tripId: string, joined: JoinedUpdate) => { const list = byLocalTrip.get(tripId) ?? []; list.push(joined); byLocalTrip.set(tripId, list); };
  const ids = [...snapshot.byTrip.keys()];
  const local = await reader.trips(ids);
  let matchedTrips = 0;
  for (const [tripId, updates] of snapshot.byTrip) if (local.has(tripId)) for (const update of updates) { add(tripId, { update, via: 'trip_id' }); matchedTrips++; }
  const missing = ids.filter(id => !local.has(id));
  const result: FeedJoin = { byLocalTrip, extensions: [], matchedTrips, identityMatched: 0, unknownTrips: 0, rejected: { ambiguous: 0, mismatch: 0, noSchedule: 0 } };
  if (!missing.length) return result;
  const remapped = remap ? await remap.lookup(missing) : new Map();
  const pending: { update: TripUpdate; identity: TripIdentity; serviceId: string; date: string }[] = [];
  for (const id of missing) {
    const target = remapped.get(id);
    const updates = snapshot.byTrip.get(id)!;
    if (!target) { result.unknownTrips += updates.length; continue; }
    for (const update of updates) {
      const start = startSeconds(update.trip?.startTime); const date = update.trip?.startDate;
      // Identity joins need the descriptor's own service date and first-departure time: no guessing.
      if (start === undefined || !date || !/^\d{8}$/.test(date)) { result.rejected.mismatch++; continue; }
      pending.push({ update, identity: { routeId: target.routeId, direction: target.direction, shapeId: target.shapeId, start }, serviceId: target.serviceId, date });
    }
  }
  if (!pending.length) return result;
  const runs = new Map<string, Set<string>>();
  for (const date of new Set(pending.map(entry => entry.date))) runs.set(date, await remap!.activeServices(date));
  const candidates = await reader.tripsByIdentity(pending.map(entry => entry.identity));
  const byKey = new Map<string, TripInfo[]>();
  for (const trip of candidates) {
    const key = identityKey({ routeId: trip.routeId, direction: trip.direction, shapeId: trip.shapeId, start: trip.start });
    const list = byKey.get(key) ?? []; list.push(trip); byKey.set(key, list);
  }
  const patterns = await reader.patterns([...new Set(candidates.map(trip => trip.patternId))]);
  const localCalendar = await reader.calendar([...runs.keys()]);
  const localRuns = new Map([...runs.keys()].map(date => [date, activeServiceIds(localCalendar.rows, localCalendar.exceptions, date)]));
  for (const entry of pending) {
    if (!runs.get(entry.date)?.has(entry.serviceId)) { result.rejected.mismatch++; continue; }
    const matches = byKey.get(identityKey(entry.identity)) ?? [];
    if (!matches.length) { result.rejected.noSchedule++; continue; }
    const runningLocally = matches.filter(trip => localRuns.get(entry.date)?.has(trip.serviceId));
    const pool = runningLocally.length ? runningLocally : matches;
    const equivalent = pool.every(trip => trip.patternId === pool[0]!.patternId && trip.vectorId === pool[0]!.vectorId);
    if (runningLocally.length > 1 || !equivalent) { result.rejected.ambiguous++; continue; }
    const chosen = [...pool].sort((a, b) => a.tripId.localeCompare(b.tripId))[0]!;
    if (!consistent(entry.update, patterns.get(chosen.patternId))) { result.rejected.mismatch++; continue; }
    // Re-key the update to the local trip, keeping the live descriptor's date and time.
    add(chosen.tripId, { update: entry.update, via: 'identity' });
    result.matchedTrips++; result.identityMatched++;
    if (!runningLocally.length) result.extensions.push({ trip: chosen, serviceDate: entry.date });
  }
  return result;
}

/** Every reported stop_sequence (and stop_id when given) must exist in the matched pattern. */
function consistent(update: TripUpdate, pattern: PatternInfo | undefined): boolean {
  if (!pattern) return false;
  const sequences = new Map(pattern.sequences.map((sequence, index) => [sequence, index]));
  for (const stopUpdate of update.stopTimeUpdate ?? []) {
    if (stopUpdate.stopSequence !== undefined) {
      const at = sequences.get(stopUpdate.stopSequence);
      if (at === undefined || (stopUpdate.stopId && pattern.stopIds[at] !== stopUpdate.stopId)) return false;
    } else if (!stopUpdate.stopId || !pattern.stopIds.includes(stopUpdate.stopId)) return false;
  }
  return true;
}
