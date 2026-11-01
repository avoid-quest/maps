import { identityKey, type PatternInfo, type TimetableReader, type TripIdentity, type TripInfo } from './reader';
import { startSeconds, type RealtimeSnapshot, type TripUpdate } from './realtime';
import type { RemapStore } from './remap';
import { activeServiceIds, addDays, weekday } from './calendar';
import { validDate } from './package-format';

/**
 * Joins every TripUpdate of a feed to the installed timetable once per feed and package:
 * 1. by trip_id (fast path);
 * 2. otherwise, when a remap knows the live trip_id, by schedule identity — route, direction,
 *    shape and the descriptor's start_time — on the descriptor's start_date, requiring that GTT's
 *    current calendar runs the remapped service on that date, that the local timing variants
 *    sharing the identity agree (or calendar evidence singles one out), and that every reported stop_sequence (and stop_id)
 *    exists in the matched local pattern. All local variants sharing the identity are compared,
 *    whether or not they run locally that day; conflicting variants are not joined.
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
  /** `calendar`: the remap's calendar does not run the live trip's service that day (it may be stale). */
  rejected: { ambiguous: number; mismatch: number; noSchedule: number; calendar: number };
  /** The optional remap could not be read; exact trip_id joins are unaffected. */
  remapFailed?: boolean;
}

/** A failure reading the optional remap store (as opposed to the installed timetable). */
export class RemapReadError extends Error {
  constructor(readonly cause: unknown) { super(`remap unreadable: ${String((cause as Error)?.message ?? cause)}`); this.name = 'RemapReadError'; }
}
function guarded(store: RemapStore): Pick<RemapStore, 'lookup' | 'activeServices' | 'calendarRow'> {
  const wrap = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => async (...args: A) => {
    try { return await call(...args); } catch (error) { throw new RemapReadError(error); }
  };
  return { lookup: wrap(ids => store.lookup(ids)), activeServices: wrap(date => store.activeServices(date)), calendarRow: wrap(id => store.calendarRow(id)) };
}

/** Days of calendar evidence compared when local timing variants share one identity. */
const EVIDENCE_DAYS = 14;
const MIN_EVIDENCE_DAYS = 3;

export async function joinFeed(snapshot: RealtimeSnapshot, reader: TimetableReader, remap?: RemapStore): Promise<FeedJoin> {
  const byLocalTrip = new Map<string, JoinedUpdate[]>();
  const add = (tripId: string, joined: JoinedUpdate) => { const list = byLocalTrip.get(tripId) ?? []; list.push(joined); byLocalTrip.set(tripId, list); };
  const ids = [...snapshot.byTrip.keys()];
  const local = await reader.trips(ids);
  let matchedTrips = 0;
  for (const [tripId, updates] of snapshot.byTrip) if (local.has(tripId)) for (const update of updates) { add(tripId, { update, via: 'trip_id' }); matchedTrips++; }
  const missing = ids.filter(id => !local.has(id));
  const result: FeedJoin = { byLocalTrip, extensions: [], matchedTrips, identityMatched: 0, unknownTrips: 0, rejected: { ambiguous: 0, mismatch: 0, noSchedule: 0, calendar: 0 } };
  if (!missing.length) return result;
  if (!remap) { for (const id of missing) result.unknownTrips += snapshot.byTrip.get(id)!.length; return result; }
  try {
    // Identity results are committed only if every remap read succeeds.
    const joins = await identityJoins(snapshot, reader, guarded(remap), missing, result);
    for (const join of joins) {
      add(join.trip.tripId, { update: join.update, via: 'identity' });
      result.matchedTrips++; result.identityMatched++;
      if (join.extension) result.extensions.push({ trip: join.trip, serviceDate: join.date });
    }
  } catch (error) {
    // Only the optional remap may fail quietly; errors of the installed timetable propagate.
    if (!(error instanceof RemapReadError)) throw error;
    // A damaged or unreadable remap must not take exact joins (or the board) down with it.
    result.remapFailed = true;
    result.rejected = { ambiguous: 0, mismatch: 0, noSchedule: 0, calendar: 0 };
    result.unknownTrips = missing.reduce((sum, id) => sum + snapshot.byTrip.get(id)!.length, 0);
  }
  return result;
}

async function identityJoins(snapshot: RealtimeSnapshot, reader: TimetableReader, remap: Pick<RemapStore, 'lookup' | 'activeServices' | 'calendarRow'>, missing: string[], result: FeedJoin) {
  const remapped = await remap.lookup(missing);
  const pending: { update: TripUpdate; identity: TripIdentity; serviceId: string; date: string }[] = [];
  for (const id of missing) {
    const target = remapped.get(id);
    const updates = snapshot.byTrip.get(id)!;
    if (!target) { result.unknownTrips += updates.length; continue; }
    for (const update of updates) {
      const start = startSeconds(update.trip?.startTime); const date = update.trip?.startDate;
      // Identity joins need the descriptor's own service date and first-departure time: no guessing.
      if (start === undefined || !validDate(date)) { result.rejected.mismatch++; continue; }
      pending.push({ update, identity: { routeId: target.routeId, direction: target.direction, shapeId: target.shapeId, start }, serviceId: target.serviceId, date });
    }
  }
  if (!pending.length) return [];
  const { validFrom, validTo } = reader.meta;
  const remoteRuns = new Map<string, Set<string>>(); const localRuns = new Map<string, Set<string>>();
  const runs = async (dates: string[]) => {
    const needed = dates.filter(date => !remoteRuns.has(date));
    if (!needed.length) return;
    const calendar = await reader.calendar(needed);
    for (const date of needed) {
      remoteRuns.set(date, await remap.activeServices(date));
      localRuns.set(date, activeServiceIds(calendar.rows, calendar.exceptions, date));
    }
  };
  await runs([...new Set(pending.map(entry => entry.date))]);
  const candidates = await reader.tripsByIdentity(pending.map(entry => entry.identity));
  const byKey = new Map<string, TripInfo[]>();
  for (const trip of candidates) {
    // Realtime start_time may be the first arrival or the first departure: index both.
    for (const start of new Set([trip.start, trip.firstDeparture])) {
      const key = identityKey({ routeId: trip.routeId, direction: trip.direction, shapeId: trip.shapeId, start });
      const list = byKey.get(key) ?? []; list.push(trip); byKey.set(key, list);
    }
  }
  const patterns = await reader.patterns([...new Set(candidates.map(trip => trip.patternId))]);
  const joins: { trip: TripInfo; update: TripUpdate; date: string; extension: boolean }[] = [];
  for (const entry of pending) {
    if (!remoteRuns.get(entry.date)?.has(entry.serviceId)) { result.rejected.calendar++; continue; }
    const matches = byKey.get(identityKey(entry.identity)) ?? [];
    if (!matches.length) { result.rejected.noSchedule++; continue; }
    // Every local variant sharing the identity is considered, running locally or not: after GTT
    // changes service assignments the live trip may correspond to any of them.
    // Evidence 1: every reported stop_sequence/stop_id must exist in the variant's pattern.
    let plausible = matches.filter(trip => consistent(entry.update, patterns.get(trip.patternId)));
    if (!plausible.length) { result.rejected.mismatch++; continue; }
    const classes = new Map<string, TripInfo[]>();
    for (const trip of plausible) { const key = `${trip.patternId}/${trip.vectorId}`; classes.set(key, [...(classes.get(key) ?? []), trip]); }
    if (classes.size > 1) {
      // Evidence 2: GTT's current calendar for the live trip's service. A timing variant is
      // established only if it is the single variant that runs locally on every day the live
      // service runs in the coming fortnight (as far as both calendars define), or — when GTT
      // defines the service for too few days — on every weekday it runs. Otherwise the variants
      // are not separable and nothing is joined.
      const remote = await remap.calendarRow(entry.serviceId);
      const window: string[] = [];
      for (let day = 0; day < EVIDENCE_DAYS; day++) {
        const date = addDays(entry.date, day);
        if (date >= validFrom && date <= validTo && (!remote || (date >= remote.start && date <= remote.end))) window.push(date);
      }
      let agreeing: TripInfo[][];
      if (window.length >= MIN_EVIDENCE_DAYS) {
        await runs(window);
        agreeing = [...classes.values()].filter(variant => window.every(date =>
          !remoteRuns.get(date)!.has(entry.serviceId) || variant.some(trip => localRuns.get(date)!.has(trip.serviceId))));
      } else if (remote?.mask) {
        // Weekdays on which each variant actually runs locally (weekly pattern and calendar_dates
        // exceptions alike), over the four weeks of local calendar nearest the live date.
        const sample: string[] = [];
        for (let day = -27; day < 28 && sample.length < 28; day++) { const date = addDays(entry.date, day); if (date >= validFrom && date <= validTo) sample.push(date); }
        if (sample.length < 7) { result.rejected.ambiguous++; continue; }
        await runs(sample);
        agreeing = [...classes.values()].filter(variant => {
          const weekdays = new Set(sample.filter(date => variant.some(trip => localRuns.get(date)!.has(trip.serviceId))).map(weekday));
          return [0, 1, 2, 3, 4, 5, 6].every(day => !(remote.mask & (1 << day)) || weekdays.has(day));
        });
      } else agreeing = [];
      if (agreeing.length !== 1) { result.rejected.ambiguous++; continue; }
      plausible = agreeing[0]!;
    }
    const runningLocally = plausible.filter(trip => localRuns.get(entry.date)?.has(trip.serviceId));
    // Identical schedules running twice locally would duplicate rows: leave both scheduled-only.
    if (runningLocally.length > 1) { result.rejected.ambiguous++; continue; }
    const chosen = runningLocally[0] ?? [...plausible].sort((a, b) => a.tripId.localeCompare(b.tripId))[0]!;
    // Re-key the update to the local trip, keeping the live descriptor's date and time.
    joins.push({ trip: chosen, update: entry.update, date: entry.date, extension: !runningLocally.length });
  }
  return joins;
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

/**
 * Whether a board should ask for a remap refresh (still at most daily): live trip IDs unknown to
 * the remap; GTT's calendar in the remap not running a live trip's service (GTT may have extended
 * calendars while keeping trip IDs); or a remap older than a day that the board relies on.
 */
export function remapRefreshReason(join: FeedJoin, remapFetchedAt: number | undefined, now: number, staleAfterMs: number): 'unknown-trips' | 'stale' | undefined {
  if (join.unknownTrips > 0) return 'unknown-trips';
  const relied = join.identityMatched + join.rejected.ambiguous + join.rejected.mismatch + join.rejected.noSchedule + join.rejected.calendar;
  if (join.rejected.calendar > 0) return 'stale';
  if (relied > 0 && remapFetchedAt !== undefined && (now - remapFetchedAt > staleAfterMs || now < remapFetchedAt)) return 'stale';
  return undefined;
}
