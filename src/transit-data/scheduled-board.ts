import { activeServiceIds, addDays, romeDate, serviceDayOrigin, withinCoverage, type ServiceDate } from './calendar';
import type { PatternInfo, TimetableReader, TimingVector, TripInfo } from './reader';

export interface BoardWindow { lookbackMs: number; horizonMs: number }
/** Look back far enough to keep delayed vehicles; never extrapolate beyond the package calendar. */
export const DEFAULT_WINDOW: BoardWindow = { lookbackMs: 30 * 60_000, horizonMs: 3 * 3_600_000 };

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
  frequency?: { headwaySeconds: number; from: number; until: number };
}

export interface ScheduledResult { events: ScheduledEvent[]; coverage: 'covered' | 'outside'; serviceDates: ServiceDate[] }

const NO_PICKUP = 1;

export async function scheduledEvents(reader: TimetableReader, stopId: string, now: number, window: BoardWindow = DEFAULT_WINDOW): Promise<ScheduledResult> {
  const { validFrom, validTo, maxTripSeconds } = reader.meta;
  const today = romeDate(now);
  if (!withinCoverage(today, validFrom, validTo)) return { events: [], coverage: 'outside', serviceDates: [] };
  const serviceDates = [addDays(today, -1), today, addDays(today, 1)].filter(date => withinCoverage(date, validFrom, validTo));
  const visits = await reader.stopVisits(stopId);
  if (!visits.length) return { events: [], coverage: 'covered', serviceDates };
  const patternIds = [...new Set(visits.map(visit => visit.patternId))];
  const calendar = await reader.calendar(serviceDates);
  const from = now - window.lookbackMs; const to = now + window.horizonMs;
  const candidates: { trip: TripInfo; date: ServiceDate; origin: number }[] = [];
  for (const date of serviceDates) {
    const services = [...activeServiceIds(calendar.rows, calendar.exceptions, date)];
    if (!services.length) continue;
    const origin = serviceDayOrigin(date);
    const startMin = Math.floor((from - origin) / 1000) - maxTripSeconds; const startMax = Math.ceil((to - origin) / 1000);
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
    for (const visit of visits) {
      if (visit.patternId !== trip.patternId) continue;
      const position = visit.position;
      // A terminating arrival or a no-pickup visit is not a departure from this stop.
      if (position === pattern.stopIds.length - 1 || Math.floor((pattern.codes?.[position] ?? 0) / 4) === NO_PICKUP) continue;
      const offset = vector.departures[position]!;
      const base = { trip, serviceDate: date, origin, position, pattern, vector };
      if (!trip.frequency?.length) {
        const at = origin + (trip.start + offset) * 1000;
        if (at >= from && at <= to) events.push({ ...base, start: trip.start, scheduledAt: at });
        continue;
      }
      for (const frequency of trip.frequency) {
        if (frequency.exactTimes) {
          for (let start = frequency.start; start < frequency.end; start += frequency.headway) {
            const at = origin + (start + offset) * 1000;
            if (at >= from && at <= to) events.push({ ...base, start, scheduledAt: at });
          }
        } else {
          // Inexact headways describe a service level, not departures: no fabricated exact time.
          const first = origin + (frequency.start + offset) * 1000; const last = origin + (frequency.end + offset) * 1000;
          if (last >= now && first <= to) events.push({ ...base, start: frequency.start, frequency: { headwaySeconds: frequency.headway, from: first, until: last } });
        }
      }
    }
  }
  return { events, coverage: 'covered', serviceDates };
}

/** Scheduled seconds-after-origin for an event kind at a pattern position. */
export function scheduledSeconds(event: Pick<ScheduledEvent, 'start' | 'vector'>, position: number, kind: 'arrival' | 'departure'): number {
  return event.start + (kind === 'arrival' ? event.vector.arrivals[position]! : event.vector.departures[position]!);
}
