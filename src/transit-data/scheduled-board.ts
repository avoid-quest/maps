import { activeServiceIds, addDays, coverageAt, romeDate, serviceDayOrigin, withinCoverage, type ServiceDate } from './calendar';
import type { PatternInfo, TimetableReader, TimingVector, TripInfo } from './reader';

export interface BoardWindow { lookbackMs: number; horizonMs: number }
/** Largest delay or advance accepted from realtime; larger values are treated as invalid. */
export const MAX_REALTIME_SHIFT_S = 3 * 3600;
/**
 * The lookback equals the accepted delay range, so any trip whose prediction can still be upcoming
 * is a candidate; rows whose scheduled time has passed without a prediction are dropped later.
 * Nothing is extrapolated beyond the package calendar.
 */
export const DEFAULT_WINDOW: BoardWindow = { lookbackMs: MAX_REALTIME_SHIFT_S * 1000, horizonMs: 3 * 3_600_000 };

/** One scheduled visit of one trip instance to the stop, with the timing needed for realtime joins. */
export interface ScheduledEvent {
  trip: TripInfo;
  serviceDate: ServiceDate;
  /** Epoch ms of GTFS time 0 on the service date. */
  origin: number;
  /** Instance start in GTFS seconds (differs from trip.start for exact frequencies). */
  start: number;
  position: number;
  pattern: PatternInfo;
  vector: TimingVector;
  /** Exact scheduled departure (ms); undefined for inexact frequency service. */
  scheduledAt?: number;
  /** Inexact frequency service level (ms bounds at this stop), with its period in GTFS seconds. */
  frequency?: { headwaySeconds: number; from: number; until: number; startSeconds: number; endSeconds: number };
  /**
   * An instance of inexact frequency service identified by a realtime start_time: its stop times
   * are template offsets, so only absolute predicted times may be shown, never delay arithmetic.
   */
  inexact?: boolean;
  /**
   * A local schedule whose service does not run on this date in the installed calendar, shown only
   * because a live update matched it by schedule identity (GTT re-issued the trip under a new ID).
   */
  extended?: boolean;
  /** Scheduled after the board horizon: shown only if realtime predicts it inside the horizon. */
  beyondHorizon?: boolean;
}

export interface ScheduledResult { events: ScheduledEvent[]; coverage: 'covered' | 'outside'; serviceDates: ServiceDate[] }

const NO_PICKUP = 1;

export async function scheduledEvents(reader: TimetableReader, stopId: string, now: number, window: BoardWindow = DEFAULT_WINDOW, options: { early?: boolean } = {}): Promise<ScheduledResult> {
  const { validFrom, validTo, maxTripSeconds, maxEventSeconds } = reader.meta;
  // Coverage follows service dates and event times: overnight trips of the final day are included.
  if (coverageAt(reader.meta, now) === 'outside') return { events: [], coverage: 'outside', serviceDates: [] };
  const from = now - window.lookbackMs; const to = now + window.horizonMs;
  // Candidates also reach past the horizon by the largest accepted advance: a trip scheduled later
  // that runs early can be predicted inside the window (shown only with such a prediction).
  const reach = to + (options.early ? MAX_REALTIME_SHIFT_S * 1000 : 0);
  // Every service date whose events can fall in [from, reach]: back by the package's longest
  // service-day span (times above 24:00), forward to the date of `reach`.
  const serviceDates: ServiceDate[] = [];
  for (let date = addDays(romeDate(from), -Math.ceil(maxEventSeconds / 86_400)); date <= romeDate(reach); date = addDays(date, 1)) {
    if (withinCoverage(date, validFrom, validTo)) serviceDates.push(date);
  }
  const visits = await reader.stopVisits(stopId);
  if (!visits.length) return { events: [], coverage: 'covered', serviceDates };
  const patternIds = [...new Set(visits.map(visit => visit.patternId))];
  const calendar = await reader.calendar(serviceDates);
  const candidates: { trip: TripInfo; date: ServiceDate; origin: number }[] = [];
  for (const date of serviceDates) {
    const services = [...activeServiceIds(calendar.rows, calendar.exceptions, date)];
    if (!services.length) continue;
    const origin = serviceDayOrigin(date);
    const startMin = Math.floor((from - origin) / 1000) - maxTripSeconds; const startMax = Math.ceil((reach - origin) / 1000);
    if (startMax < 0) continue;
    for (const trip of await reader.tripsForPatterns(patternIds, services, Math.max(0, startMin), startMax)) candidates.push({ trip, date, origin });
  }
  const [patterns, vectors] = await Promise.all([
    reader.patterns(patternIds),
    reader.vectors([...new Set(candidates.map(candidate => candidate.trip.vectorId))]),
  ]);
  const events: ScheduledEvent[] = [];
  for (const { trip, date, origin } of candidates) {
    const pattern = patterns.get(trip.patternId); const vector = vectors.get(trip.vectorId);
    if (!pattern || !vector) continue;
    expandTrip(events, { trip, date, origin, pattern, vector, visits, from, to: reach, now, horizon: to });
  }
  return { events, coverage: 'covered', serviceDates };
}

/**
 * Events at this stop for specific trips on specific service dates (identity-joined live trips
 * outside the installed calendar). Only exact-time trips; times come from the local pattern.
 */
export async function eventsForTrips(reader: TimetableReader, stopId: string, trips: readonly { trip: TripInfo; serviceDate: ServiceDate }[], now: number, window: BoardWindow = DEFAULT_WINDOW): Promise<ScheduledEvent[]> {
  const relevant = trips.filter(entry => !entry.trip.frequency?.length);
  if (!relevant.length) return [];
  const visits = (await reader.stopVisits(stopId)).filter(visit => relevant.some(entry => entry.trip.patternId === visit.patternId));
  if (!visits.length) return [];
  const [patterns, vectors] = await Promise.all([
    reader.patterns([...new Set(relevant.map(entry => entry.trip.patternId))]),
    reader.vectors([...new Set(relevant.map(entry => entry.trip.vectorId))]),
  ]);
  const events: ScheduledEvent[] = [];
  for (const { trip, serviceDate } of relevant) {
    const pattern = patterns.get(trip.patternId); const vector = vectors.get(trip.vectorId);
    if (!pattern || !vector) continue;
    expandTrip(events, { trip, date: serviceDate, origin: serviceDayOrigin(serviceDate), pattern, vector, visits, from: now - window.lookbackMs, to: now + window.horizonMs + MAX_REALTIME_SHIFT_S * 1000, now, horizon: now + window.horizonMs });
  }
  return events.map(event => ({ ...event, extended: true }));
}

function expandTrip(events: ScheduledEvent[], input: { trip: TripInfo; date: ServiceDate; origin: number; pattern: PatternInfo; vector: TimingVector; visits: readonly { patternId: number; position: number }[]; from: number; to: number; now: number; horizon: number }) {
  const { trip, date, origin, pattern, vector, visits, from, to, now, horizon } = input;
  const mark = (event: ScheduledEvent): ScheduledEvent => event.scheduledAt !== undefined && event.scheduledAt > horizon ? { ...event, beyondHorizon: true } : event;
  {
    for (const visit of visits) {
      if (visit.patternId !== trip.patternId) continue;
      const position = visit.position;
      // A terminating arrival or a no-pickup visit is not a departure from this stop.
      if (position === pattern.stopIds.length - 1 || Math.floor((pattern.codes?.[position] ?? 0) / 4) === NO_PICKUP) continue;
      const offset = vector.departures[position]!;
      const base = { trip, serviceDate: date, origin, position, pattern, vector };
      if (!trip.frequency?.length) {
        const at = origin + (trip.start + offset) * 1000;
        if (at >= from && at <= to) events.push(mark({ ...base, start: trip.start, scheduledAt: at }));
        continue;
      }
      for (const frequency of trip.frequency) {
        if (frequency.exactTimes) {
          for (let start = frequency.start; start < frequency.end; start += frequency.headway) {
            const at = origin + (start + offset) * 1000;
            if (at >= from && at <= to) events.push(mark({ ...base, start, scheduledAt: at }));
          }
        } else {
          // Inexact headways describe a service level, not departures: no fabricated exact time.
          const first = origin + (frequency.start + offset) * 1000; const last = origin + (frequency.end + offset) * 1000;
          if (last >= now && first <= horizon) events.push({ ...base, start: frequency.start, frequency: { headwaySeconds: frequency.headway, from: first, until: last, startSeconds: frequency.start, endSeconds: frequency.end } });
        }
      }
    }
  }
}

/** Scheduled seconds-after-origin for an event kind at a pattern position. */
export function scheduledSeconds(event: Pick<ScheduledEvent, 'start' | 'vector'>, position: number, kind: 'arrival' | 'departure'): number {
  return event.start + (kind === 'arrival' ? event.vector.arrivals[position]! : event.vector.departures[position]!);
}
