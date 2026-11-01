import type { CalendarException, CalendarRow } from './calendar';
import { decodeVector, PackageError, type TimetablePackage } from './package-format';
import type { DatasetMeta, PatternInfo, RouteInfo, StopInfo, StopVisit, TimetableReader, TimingVector, TripInfo } from './reader';
import { placeholders, type SqlDatabase, type SqlValue } from './sql';

export const DB_SCHEMA_VERSION = 2;
const SCHEMA = `
PRAGMA journal_mode = DELETE;
CREATE TABLE dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE stop (stop_id TEXT PRIMARY KEY, public_code TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, parent_station TEXT NOT NULL, location_type INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE agency (agency_id TEXT PRIMARY KEY, name TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE route (route_id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, route_type INTEGER NOT NULL, public_name TEXT NOT NULL, long_name TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE pattern_stop (pattern_id INTEGER NOT NULL, occurrence INTEGER NOT NULL, stop_sequence INTEGER NOT NULL, stop_id TEXT NOT NULL, pickup_type INTEGER NOT NULL, drop_off_type INTEGER NOT NULL, PRIMARY KEY (pattern_id, occurrence)) WITHOUT ROWID;
CREATE TABLE timing_vector (vector_id INTEGER PRIMARY KEY, arrival_offsets TEXT NOT NULL, departure_offsets TEXT);
CREATE TABLE trip (trip_id TEXT PRIMARY KEY, route_id TEXT NOT NULL, service_id TEXT NOT NULL, pattern_id INTEGER NOT NULL, vector_id INTEGER NOT NULL, start_seconds INTEGER NOT NULL, headsign TEXT NOT NULL, direction INTEGER NOT NULL, shape_id TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE frequency (trip_id TEXT NOT NULL, start_seconds INTEGER NOT NULL, end_seconds INTEGER NOT NULL, headway_seconds INTEGER NOT NULL, exact_times INTEGER NOT NULL);
CREATE TABLE service_calendar (service_id TEXT PRIMARY KEY, weekday_mask INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE service_exception (date TEXT NOT NULL, service_id TEXT NOT NULL, exception_type INTEGER NOT NULL, PRIMARY KEY (date, service_id)) WITHOUT ROWID;
`;
const INDEXES = `
CREATE INDEX pattern_stop_by_stop ON pattern_stop (stop_id, pattern_id);
CREATE INDEX trip_by_pattern ON trip (pattern_id, service_id, start_seconds);
CREATE INDEX trip_identity ON trip (route_id, direction, shape_id, start_seconds);
CREATE INDEX frequency_by_trip ON frequency (trip_id);
`;

async function insertRows(db: SqlDatabase, table: string, columns: string[], rows: SqlValue[][]) {
  const batch = Math.max(1, Math.floor(900 / columns.length));
  for (let offset = 0; offset < rows.length; offset += batch) {
    const slice = rows.slice(offset, offset + batch);
    await db.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${slice.map(() => `(${placeholders(columns.length)})`).join(',')}`, slice.flat());
  }
}

/** Writes the whole package in one transaction into an empty candidate database. */
export async function importPackage(db: SqlDatabase, pkg: TimetablePackage, meta: DatasetMeta): Promise<void> {
  await db.exec(SCHEMA);
  await db.transaction(async () => {
    const metaRows: [string, string][] = [
      ['db_schema_version', String(DB_SCHEMA_VERSION)], ['package_hash', meta.packageHash], ['feed_version', meta.feedVersion],
      ['valid_from', meta.validFrom], ['valid_to', meta.validTo], ['max_trip_seconds', String(meta.maxTripSeconds)], ['max_event_seconds', String(meta.maxEventSeconds)],
      ['source', meta.source], ['manifest', JSON.stringify(meta.manifest)],
      ['trip_count', String(pkg.trips.trip_id.length)], ['stop_count', String(pkg.stops.length)],
    ];
    await insertRows(db, 'dataset_meta', ['key', 'value'], metaRows);
    await insertRows(db, 'stop', ['stop_id', 'public_code', 'name', 'lat', 'lon', 'parent_station', 'location_type'], pkg.stops.map(stop => [...stop]));
    await insertRows(db, 'agency', ['agency_id', 'name'], pkg.agencies.map(agency => [...agency]));
    await insertRows(db, 'route', ['route_id', 'agency_id', 'route_type', 'public_name', 'long_name'], pkg.routes.map(route => [...route]));
    const patternRows: SqlValue[][] = [];
    pkg.patterns.forEach(([refs, sequences, codes], patternId) => refs.forEach((ref, occurrence) => {
      const code = codes?.[occurrence] ?? 0;
      patternRows.push([patternId, occurrence, sequences[occurrence]!, pkg.stops[ref]![0], Math.floor(code / 4), code % 4]);
    }));
    await insertRows(db, 'pattern_stop', ['pattern_id', 'occurrence', 'stop_sequence', 'stop_id', 'pickup_type', 'drop_off_type'], patternRows);
    await insertRows(db, 'timing_vector', ['vector_id', 'arrival_offsets', 'departure_offsets'], pkg.vectors.map((vector, id) => {
      const { arrivals, departures } = decodeVector(vector);
      return [id, arrivals.join(','), vector[1] ? departures.join(',') : null];
    }));
    const t = pkg.trips;
    await insertRows(db, 'trip', ['trip_id', 'route_id', 'service_id', 'pattern_id', 'vector_id', 'start_seconds', 'headsign', 'direction', 'shape_id'],
      t.trip_id.map((tripId, index) => [tripId, pkg.routes[t.route[index]!]![0], pkg.services[t.service[index]!]![0], t.pattern[index]!, t.vector[index]!, t.start[index]!, pkg.headsigns[t.headsign[index]!]!, t.direction[index]!, pkg.shapes[t.shape[index]!]!]));
    await insertRows(db, 'frequency', ['trip_id', 'start_seconds', 'end_seconds', 'headway_seconds', 'exact_times'],
      pkg.frequencies.map(([trip, start, end, headway, exact]) => [t.trip_id[trip]!, start, end, headway, exact]));
    await insertRows(db, 'service_calendar', ['service_id', 'weekday_mask', 'start_date', 'end_date'], pkg.services.map(([id, mask, start, end]) => [id, mask, start, end]));
    await insertRows(db, 'service_exception', ['date', 'service_id', 'exception_type'],
      pkg.services.flatMap(([id, , , , added, removed]) => [...added.map(date => [date, id, 1]), ...removed.map(date => [date, id, 2])]));
    await db.exec(INDEXES);
  });
}

export async function readMeta(db: SqlDatabase): Promise<DatasetMeta> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM dataset_meta');
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  if (values.db_schema_version !== String(DB_SCHEMA_VERSION) || !values.package_hash || !values.manifest
    || !Number.isFinite(Number(values.max_trip_seconds)) || !Number.isFinite(Number(values.max_event_seconds))) throw new PackageError('Database orari incompleto.');
  return {
    packageHash: values.package_hash, feedVersion: values.feed_version ?? '', validFrom: values.valid_from ?? '', validTo: values.valid_to ?? '',
    maxTripSeconds: Number(values.max_trip_seconds), maxEventSeconds: Number(values.max_event_seconds), source: values.source === 'bundled' ? 'bundled' : 'downloaded', manifest: JSON.parse(values.manifest),
  };
}

const offsets = (value: string) => value.split(',').map(Number);
interface TripRow { trip_id: string; route_id: string; service_id: string; pattern_id: number; vector_id: number; start_seconds: number; headsign: string; direction: number; shape_id: string }
const tripInfo = (row: TripRow): TripInfo => ({ tripId: row.trip_id, routeId: row.route_id, serviceId: row.service_id, patternId: row.pattern_id, vectorId: row.vector_id, start: row.start_seconds, headsign: row.headsign, direction: row.direction, shapeId: row.shape_id });
const TRIP_COLUMNS = 'trip_id, route_id, service_id, pattern_id, vector_id, start_seconds, headsign, direction, shape_id';

export function createSqlReader(db: SqlDatabase, meta: DatasetMeta): TimetableReader {
  let routes: Promise<Map<string, RouteInfo>> | undefined;
  async function attachFrequencies(trips: TripInfo[]) {
    if (!trips.length) return trips;
    const rows = await db.all<{ trip_id: string; start_seconds: number; end_seconds: number; headway_seconds: number; exact_times: number }>(
      `SELECT * FROM frequency WHERE trip_id IN (${placeholders(trips.length)})`, trips.map(trip => trip.tripId));
    for (const row of rows) {
      const trip = trips.find(candidate => candidate.tripId === row.trip_id)!;
      (trip.frequency ??= []).push({ start: row.start_seconds, end: row.end_seconds, headway: row.headway_seconds, exactTimes: row.exact_times === 1 });
    }
    return trips;
  }
  const stopInfo = (row: { stop_id: string; public_code: string; name: string; lat: number; lon: number; parent_station: string; location_type: number }): StopInfo =>
    ({ stopId: row.stop_id, code: row.public_code, name: row.name, lat: row.lat, lon: row.lon, parentStation: row.parent_station, locationType: row.location_type });
  return {
    meta,
    routes() {
      routes ??= db.all<{ route_id: string; agency_id: string; route_type: number; public_name: string; long_name: string }>('SELECT * FROM route')
        .then(rows => new Map(rows.map(row => [row.route_id, { routeId: row.route_id, agencyId: row.agency_id, routeType: row.route_type, shortName: row.public_name, longName: row.long_name }])));
      return routes;
    },
    async agencies() {
      return new Map((await db.all<{ agency_id: string; name: string }>('SELECT agency_id, name FROM agency')).map(row => [row.agency_id, row.name]));
    },
    async stop(stopId) {
      const [row] = await db.all<Parameters<typeof stopInfo>[0]>('SELECT * FROM stop WHERE stop_id = ?', [stopId]);
      return row ? stopInfo(row) : undefined;
    },
    async stops() { return (await db.all<Parameters<typeof stopInfo>[0]>('SELECT * FROM stop ORDER BY stop_id')).map(stopInfo); },
    async stopRoutes() {
      const rows = await db.all<{ stop_id: string; route_id: string }>('SELECT DISTINCT ps.stop_id, t.route_id FROM (SELECT DISTINCT pattern_id, route_id FROM trip) t JOIN pattern_stop ps ON ps.pattern_id = t.pattern_id ORDER BY ps.stop_id, t.route_id');
      const result = new Map<string, string[]>();
      for (const row of rows) { const list = result.get(row.stop_id) ?? []; list.push(row.route_id); result.set(row.stop_id, list); }
      return result;
    },
    async stopVisits(stopId): Promise<StopVisit[]> {
      const rows = await db.all<{ pattern_id: number; occurrence: number; stop_sequence: number }>('SELECT pattern_id, occurrence, stop_sequence FROM pattern_stop WHERE stop_id = ? ORDER BY pattern_id, occurrence', [stopId]);
      return rows.map(row => ({ patternId: row.pattern_id, position: row.occurrence, stopSequence: row.stop_sequence }));
    },
    async patterns(ids) {
      const result = new Map<number, PatternInfo>(); if (!ids.length) return result;
      const rows = await db.all<{ pattern_id: number; occurrence: number; stop_sequence: number; stop_id: string; pickup_type: number; drop_off_type: number }>(
        `SELECT * FROM pattern_stop WHERE pattern_id IN (${placeholders(ids.length)}) ORDER BY pattern_id, occurrence`, [...ids]);
      for (const row of rows) {
        let pattern = result.get(row.pattern_id);
        if (!pattern) result.set(row.pattern_id, pattern = { patternId: row.pattern_id, stopIds: [], sequences: [], codes: [] });
        pattern.stopIds.push(row.stop_id); pattern.sequences.push(row.stop_sequence); pattern.codes!.push(row.pickup_type * 4 + row.drop_off_type);
      }
      for (const pattern of result.values()) if (pattern.codes!.every(code => code === 0)) pattern.codes = null;
      return result;
    },
    async tripsForPatterns(patternIds, serviceIds, minStart, maxStart) {
      if (!patternIds.length || !serviceIds.length) return [];
      const params = [...patternIds, ...serviceIds];
      const where = `pattern_id IN (${placeholders(patternIds.length)}) AND service_id IN (${placeholders(serviceIds.length)})`;
      const rows = await db.all<TripRow>(
        `SELECT ${TRIP_COLUMNS} FROM trip WHERE ${where} AND start_seconds BETWEEN ? AND ?
         UNION SELECT ${TRIP_COLUMNS} FROM trip WHERE ${where} AND trip_id IN (SELECT trip_id FROM frequency)`,
        [...params, minStart, maxStart, ...params]);
      return attachFrequencies(rows.map(tripInfo));
    },
    async trips(ids) {
      if (!ids.length) return new Map();
      const rows = await db.all<TripRow>(`SELECT ${TRIP_COLUMNS} FROM trip WHERE trip_id IN (${placeholders(ids.length)})`, [...ids]);
      return new Map((await attachFrequencies(rows.map(tripInfo))).map(trip => [trip.tripId, trip]));
    },
    async tripsByIdentity(identities) {
      if (!identities.length) return [];
      const rows = await db.all<TripRow>(
        `SELECT ${TRIP_COLUMNS} FROM trip WHERE (route_id, direction, shape_id, start_seconds) IN (VALUES ${identities.map(() => '(?, ?, ?, ?)').join(', ')})`,
        identities.flatMap(identity => [identity.routeId, identity.direction, identity.shapeId, identity.start]));
      return attachFrequencies(rows.map(tripInfo));
    },
    async vectors(ids) {
      const result = new Map<number, TimingVector>(); if (!ids.length) return result;
      const rows = await db.all<{ vector_id: number; arrival_offsets: string; departure_offsets: string | null }>(
        `SELECT * FROM timing_vector WHERE vector_id IN (${placeholders(ids.length)})`, [...ids]);
      for (const row of rows) { const arrivals = offsets(row.arrival_offsets); result.set(row.vector_id, { arrivals, departures: row.departure_offsets ? offsets(row.departure_offsets) : arrivals }); }
      return result;
    },
    async calendar(dates) {
      const rows = await db.all<{ service_id: string; weekday_mask: number; start_date: string; end_date: string }>('SELECT * FROM service_calendar');
      const exceptions = dates.length ? await db.all<{ date: string; service_id: string; exception_type: number }>(
        `SELECT * FROM service_exception WHERE date IN (${placeholders(dates.length)})`, [...dates]) : [];
      return {
        rows: rows.map((row): CalendarRow => ({ serviceId: row.service_id, mask: row.weekday_mask, start: row.start_date, end: row.end_date })),
        exceptions: exceptions.map((row): CalendarException => ({ serviceId: row.service_id, date: row.date, added: row.exception_type === 1 })),
      };
    },
  };
}

/** Referential checks inside the candidate database before it may become active. */
export async function validateDatabase(db: SqlDatabase, pkg: TimetablePackage): Promise<void> {
  const [counts] = await db.all<{ stops: number; trips: number; patterns: number; vectors: number; visits: number; orphanVisits: number; orphanTrips: number; badCalendar: number }>(`
    SELECT (SELECT COUNT(*) FROM stop) AS stops, (SELECT COUNT(*) FROM trip) AS trips,
      (SELECT COUNT(DISTINCT pattern_id) FROM pattern_stop) AS patterns, (SELECT COUNT(*) FROM timing_vector) AS vectors,
      (SELECT COUNT(*) FROM pattern_stop) AS visits,
      (SELECT COUNT(*) FROM pattern_stop ps LEFT JOIN stop s ON s.stop_id = ps.stop_id WHERE s.stop_id IS NULL) AS orphanVisits,
      (SELECT COUNT(*) FROM trip t LEFT JOIN timing_vector v ON v.vector_id = t.vector_id LEFT JOIN route r ON r.route_id = t.route_id
         WHERE v.vector_id IS NULL OR r.route_id IS NULL OR NOT EXISTS (SELECT 1 FROM pattern_stop p WHERE p.pattern_id = t.pattern_id)
           OR NOT EXISTS (SELECT 1 FROM service_calendar c WHERE c.service_id = t.service_id)) AS orphanTrips,
      (SELECT COUNT(*) FROM service_calendar) - ${pkg.services.length} AS badCalendar`);
  const visits = pkg.patterns.reduce((sum, pattern) => sum + pattern[0].length, 0);
  if (!counts || counts.stops !== pkg.stops.length || counts.trips !== pkg.trips.trip_id.length || counts.patterns !== pkg.patterns.length
    || counts.vectors !== pkg.vectors.length || counts.visits !== visits || counts.orphanVisits || counts.orphanTrips || counts.badCalendar) {
    throw new PackageError('Il database orari importato non supera la verifica dei riferimenti.');
  }
  await checkDatabase(db);
}

export const REQUIRED_TABLES = ['dataset_meta', 'stop', 'agency', 'route', 'pattern_stop', 'timing_vector', 'trip', 'frequency', 'service_calendar', 'service_exception'] as const;
export const REQUIRED_INDEXES = ['pattern_stop_by_stop', 'trip_by_pattern', 'trip_identity', 'frequency_by_trip'] as const;

/**
 * Startup acceptance of an installed database: every table and index the board needs, row counts
 * recorded at import, and SQLite's own page-level check. Any failure means rollback.
 */
export async function checkDatabase(db: SqlDatabase): Promise<void> {
  const names = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")).map(row => row.name));
  const missing = [...REQUIRED_TABLES, ...REQUIRED_INDEXES].filter(name => !names.has(name));
  if (missing.length) throw new PackageError('Database orari incompleto.');
  const [counts] = await db.all<{ trips: number; stops: number; expectedTrips: string | null; expectedStops: string | null; visits: number; vectors: number }>(`
    SELECT (SELECT COUNT(*) FROM trip) AS trips, (SELECT COUNT(*) FROM stop) AS stops,
      (SELECT value FROM dataset_meta WHERE key = 'trip_count') AS expectedTrips, (SELECT value FROM dataset_meta WHERE key = 'stop_count') AS expectedStops,
      (SELECT COUNT(*) FROM pattern_stop) AS visits, (SELECT COUNT(*) FROM timing_vector) AS vectors`);
  if (!counts || String(counts.trips) !== counts.expectedTrips || String(counts.stops) !== counts.expectedStops || !counts.visits || !counts.vectors) {
    throw new PackageError('Database orari incompleto.');
  }
  const [result] = await db.all<Record<string, string>>('PRAGMA quick_check');
  if (Object.values(result ?? {})[0] !== 'ok') throw new PackageError('Database orari danneggiato.');
}
