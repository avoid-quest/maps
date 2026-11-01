import type { CalendarException, CalendarRow, ServiceDate } from './calendar';
import { decodeVector, type PackageManifest, type TimetablePackage } from './package-format';

export interface DatasetMeta {
  packageHash: string;
  feedVersion: string;
  validFrom: ServiceDate;
  validTo: ServiceDate;
  /** Longest trip duration in seconds; bounds the start-time window of a query. */
  maxTripSeconds: number;
  source: 'bundled' | 'downloaded';
  manifest: PackageManifest;
}
export interface RouteInfo { routeId: string; agencyId: string; routeType: number; shortName: string; longName: string }
export interface StopInfo { stopId: string; code: string; name: string; lat: number; lon: number; parentStation: string; locationType: number }
/** One visit of a stop pattern to a stop; repeated visits keep separate positions. */
export interface StopVisit { patternId: number; position: number; stopSequence: number }
export interface PatternInfo { patternId: number; stopIds: string[]; sequences: number[]; codes: number[] | null }
export interface TripInfo {
  tripId: string; routeId: string; serviceId: string; patternId: number; vectorId: number;
  start: number; headsign: string; direction: number;
  frequency?: { start: number; end: number; headway: number; exactTimes: boolean }[];
}
export interface TimingVector { arrivals: number[]; departures: number[] }

/** Narrow indexed queries shared by the SQLite store and the in-memory (web/oracle) reader. */
export interface TimetableReader {
  readonly meta: DatasetMeta;
  routes(): Promise<Map<string, RouteInfo>>;
  agencies(): Promise<Map<string, string>>;
  stop(stopId: string): Promise<StopInfo | undefined>;
  stops(): Promise<StopInfo[]>;
  stopRoutes(): Promise<Map<string, string[]>>;
  stopVisits(stopId: string): Promise<StopVisit[]>;
  patterns(ids: readonly number[]): Promise<Map<number, PatternInfo>>;
  /** Trips on the patterns/services whose start is within [minStart, maxStart], plus every frequency-based trip on them. */
  tripsForPatterns(patternIds: readonly number[], serviceIds: readonly string[], minStart: number, maxStart: number): Promise<TripInfo[]>;
  trips(tripIds: readonly string[]): Promise<Map<string, TripInfo>>;
  vectors(ids: readonly number[]): Promise<Map<number, TimingVector>>;
  calendar(dates: readonly ServiceDate[]): Promise<{ rows: CalendarRow[]; exceptions: CalendarException[] }>;
}

export function maxTripSeconds(pkg: TimetablePackage): number {
  let max = 0;
  for (const vector of pkg.vectors) max = Math.max(max, decodeVector(vector).departures.at(-1) ?? 0);
  return max;
}

/** Package-backed reader: used on web, in tests, and as the oracle for candidate-database validation. */
export function createMemoryReader(pkg: TimetablePackage, meta: DatasetMeta): TimetableReader {
  const routes = new Map(pkg.routes.map(([routeId, agencyId, routeType, shortName, longName]) => [routeId, { routeId, agencyId, routeType, shortName, longName }]));
  const stops = pkg.stops.map(([stopId, code, name, lat, lon, parentStation, locationType]): StopInfo => ({ stopId, code, name, lat, lon, parentStation, locationType }));
  const stopIndex = new Map(stops.map(stop => [stop.stopId, stop]));
  const visits = new Map<string, StopVisit[]>();
  pkg.patterns.forEach(([refs, sequences], patternId) => refs.forEach((ref, position) => {
    const stopId = pkg.stops[ref]![0];
    const list = visits.get(stopId) ?? []; list.push({ patternId, position, stopSequence: sequences[position]! }); visits.set(stopId, list);
  }));
  const frequencies = new Map<number, NonNullable<TripInfo['frequency']>>();
  for (const [trip, start, end, headway, exact] of pkg.frequencies) {
    const list = frequencies.get(trip) ?? []; list.push({ start, end, headway, exactTimes: exact === 1 }); frequencies.set(trip, list);
  }
  const t = pkg.trips;
  const trip = (index: number): TripInfo => ({
    tripId: t.trip_id[index]!, routeId: pkg.routes[t.route[index]!]![0], serviceId: pkg.services[t.service[index]!]![0],
    patternId: t.pattern[index]!, vectorId: t.vector[index]!, start: t.start[index]!, headsign: pkg.headsigns[t.headsign[index]!]!,
    direction: t.direction[index]!, ...(frequencies.has(index) ? { frequency: frequencies.get(index)! } : {}),
  });
  const byPattern = new Map<number, number[]>();
  t.pattern.forEach((pattern, index) => { const list = byPattern.get(pattern) ?? []; list.push(index); byPattern.set(pattern, list); });
  const tripIndex = new Map(t.trip_id.map((id, index) => [id, index]));
  const stopRoutes = new Map<string, Set<string>>();
  t.pattern.forEach((pattern, index) => {
    for (const ref of pkg.patterns[pattern]![0]) {
      const stopId = pkg.stops[ref]![0]; const set = stopRoutes.get(stopId) ?? new Set(); set.add(pkg.routes[t.route[index]!]![0]); stopRoutes.set(stopId, set);
    }
  });
  return {
    meta,
    async routes() { return routes; },
    async agencies() { return new Map(pkg.agencies); },
    async stop(stopId) { return stopIndex.get(stopId); },
    async stops() { return stops; },
    async stopRoutes() { return new Map([...stopRoutes].map(([stop, set]) => [stop, [...set].sort()])); },
    async stopVisits(stopId) { return visits.get(stopId) ?? []; },
    async patterns(ids) {
      return new Map(ids.filter(id => pkg.patterns[id]).map(id => {
        const [refs, sequences, codes] = pkg.patterns[id]!;
        return [id, { patternId: id, stopIds: refs.map(ref => pkg.stops[ref]![0]), sequences, codes }];
      }));
    },
    async tripsForPatterns(patternIds, serviceIds, minStart, maxStart) {
      const services = new Set(serviceIds); const result: TripInfo[] = [];
      for (const pattern of patternIds) for (const index of byPattern.get(pattern) ?? []) {
        if (!services.has(pkg.services[t.service[index]!]![0])) continue;
        if (frequencies.has(index) || (t.start[index]! >= minStart && t.start[index]! <= maxStart)) result.push(trip(index));
      }
      return result;
    },
    async trips(ids) {
      return new Map(ids.flatMap(id => { const index = tripIndex.get(id); return index === undefined ? [] : [[id, trip(index)] as const]; }));
    },
    async vectors(ids) {
      return new Map(ids.filter(id => pkg.vectors[id]).map(id => [id, decodeVector(pkg.vectors[id]!)]));
    },
    async calendar(dates) {
      const wanted = new Set(dates);
      return {
        rows: pkg.services.map(([serviceId, mask, start, end]) => ({ serviceId, mask, start, end })),
        exceptions: pkg.services.flatMap(([serviceId, , , , added, removed]) => [
          ...added.filter(date => wanted.has(date)).map(date => ({ serviceId, date, added: true })),
          ...removed.filter(date => wanted.has(date)).map(date => ({ serviceId, date, added: false })),
        ]),
      };
    },
  };
}
