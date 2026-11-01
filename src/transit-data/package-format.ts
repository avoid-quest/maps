/**
 * Compact GTT timetable package (format `avoid-maps.gtt-timetable`, schema 1).
 * Produced by scripts/gtt_package.py; validation here mirrors validate_package().
 * Packages are content-addressed by SHA-256 ("hashed", never "signed").
 */
export const PACKAGE_FORMAT = 'avoid-maps.gtt-timetable';
export const SCHEMA_VERSION = 2;
export const TIMEZONE = 'Europe/Rome';
export const MINIMUMS = { stops: 1000, trips: 5000, routes: 50, services: 10 } as const;

export type PackageStop = [stopId: string, code: string, name: string, lat: number, lon: number, parent: string, locationType: number];
export type PackageRoute = [routeId: string, agencyId: string, routeType: number, shortName: string, longName: string];
/** weekday mask: bit 0 = Monday … bit 6 = Sunday. Dates are YYYYMMDD. */
export type PackageService = [serviceId: string, mask: number, start: string, end: string, added: string[], removed: string[]];
/** stop indexes, real GTFS stop_sequence values, pickup*4+drop_off codes (null when all regular). */
export type PackagePattern = [stops: number[], sequences: number[], codes: number[] | null];
/** arrival increments from the trip start, dwell seconds (null when departure == arrival everywhere). */
export type PackageVector = [increments: number[], dwell: number[] | null];
export type PackageFrequency = [tripIndex: number, start: number, end: number, headway: number, exactTimes: 0 | 1];

export interface TimetablePackage {
  format: typeof PACKAGE_FORMAT;
  schema_version: typeof SCHEMA_VERSION;
  feed: { feed_version: string; valid_from: string; valid_to: string; timezone: string; publisher: string };
  agencies: [agencyId: string, name: string][];
  routes: PackageRoute[];
  stops: PackageStop[];
  services: PackageService[];
  patterns: PackagePattern[];
  vectors: PackageVector[];
  headsigns: string[];
  /** GTFS shape_ids ("" when absent); part of the schedule identity used to re-join rotated trip IDs. */
  shapes: string[];
  trips: { trip_id: string[]; route: number[]; service: number[]; pattern: number[]; vector: number[]; start: number[]; headsign: number[]; direction: number[]; shape: number[] };
  frequencies: PackageFrequency[];
}

export interface PackageManifest {
  schema_version: number;
  package_format: string;
  package_hash: string;
  package_bytes: number;
  package_path: string;
  feed_version: string;
  valid_from: string;
  valid_to: string;
  source_url: string;
  source_zip_hash: string;
  source_last_modified?: string | null;
  source_etag?: string | null;
  /** CRC-32 (hex) of GTT ZIP members, comparable with GTT's central directory. */
  source_crc32?: Record<string, string>;
  /** When the pipeline last confirmed this source against GTT; null when built from a local file without evidence. */
  upstream_checked_at: string | null;
  built_at: string;
  attribution: string;
  attribution_url: string;
  licence_url: string;
  builder_version: string;
  counts: { stops: number; routes: number; trips: number; patterns: number; vectors: number; services: number };
  previous?: { package_hash: string; package_path: string; feed_version: string }[];
}

export class PackageError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'hash' | 'storage' | 'network' | 'outdated' = 'invalid') {
    super(message);
    this.name = 'PackageError';
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PackageError(message);
}
const DATE = /^\d{8}$/;
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6)));
  return date.toISOString().slice(0, 10).replace(/-/g, '') === value;
}
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const ints = (value: unknown): value is number[] => Array.isArray(value) && value.every(isInt);

export function decodeVector(vector: PackageVector): { arrivals: number[]; departures: number[] } {
  const arrivals: number[] = []; let total = 0;
  for (const increment of vector[0]) arrivals.push(total += increment);
  const departures = vector[1] ? arrivals.map((arrival, index) => arrival + vector[1]![index]!) : arrivals;
  return { arrivals, departures };
}

/** Throws PackageError unless every reference resolves; returns the typed package. */
export function validatePackage(value: unknown): TimetablePackage {
  const pkg = value as TimetablePackage;
  check(pkg && typeof pkg === 'object' && pkg.format === PACKAGE_FORMAT && pkg.schema_version === SCHEMA_VERSION, 'Formato pacchetto orari non supportato.');
  const { feed, stops, routes, services, patterns, vectors, trips, headsigns, frequencies } = pkg;
  check(feed && validDate(feed.valid_from) && validDate(feed.valid_to) && feed.valid_from <= feed.valid_to, 'Validità del pacchetto non valida.');
  check(feed.timezone === TIMEZONE && isString(feed.feed_version), 'Fuso orario o versione del pacchetto non validi.');
  check([stops, routes, services, patterns, vectors, headsigns, frequencies, pkg.agencies, pkg.shapes].every(Array.isArray) && trips && typeof trips === 'object', 'Struttura del pacchetto incompleta.');
  const count = Array.isArray(trips.trip_id) ? trips.trip_id.length : 0;
  check(stops.length >= MINIMUMS.stops && count >= MINIMUMS.trips && routes.length >= MINIMUMS.routes && services.length >= MINIMUMS.services, 'Pacchetto orari troppo piccolo: probabile esportazione incompleta.');
  const stopIds = new Set<string>();
  for (const stop of stops) {
    check(Array.isArray(stop) && isString(stop[0]) && isString(stop[1]) && isString(stop[2]) && isString(stop[5]) && isInt(stop[6]), 'Fermata non valida.');
    check(typeof stop[3] === 'number' && typeof stop[4] === 'number' && Math.abs(stop[3]) <= 90 && Math.abs(stop[4]) <= 180 && !(stop[3] === 0 && stop[4] === 0), `Coordinate non valide per la fermata ${stop[0]}.`);
    check(!stopIds.has(stop[0]), `Fermata duplicata ${stop[0]}.`); stopIds.add(stop[0]);
  }
  const routeIds = new Set<string>();
  for (const route of routes) {
    check(Array.isArray(route) && isString(route[0]) && isString(route[1]) && isInt(route[2]) && isString(route[3]) && isString(route[4]), 'Linea non valida.');
    check(!routeIds.has(route[0]), `Linea duplicata ${route[0]}.`); routeIds.add(route[0]);
  }
  for (const service of services) {
    check(Array.isArray(service) && isString(service[0]) && isInt(service[1]) && service[1] >= 0 && service[1] < 128, 'Calendario non valido.');
    if (service[1]) check(validDate(service[2]) && validDate(service[3]) && service[2] <= service[3], `Intervallo non valido per il servizio ${service[0]}.`);
    check(Array.isArray(service[4]) && Array.isArray(service[5]) && [...service[4], ...service[5]].every(validDate), `Eccezioni non valide per il servizio ${service[0]}.`);
  }
  for (const pattern of patterns) {
    check(Array.isArray(pattern) && ints(pattern[0]) && ints(pattern[1]) && pattern[0].length === pattern[1].length && pattern[0].length >= 2, 'Sequenza di fermate non valida.');
    check(pattern[0].every(ref => ref >= 0 && ref < stops.length), 'Sequenza con fermata inesistente.');
    check(pattern[1].every((sequence, index) => index === 0 || sequence > pattern[1][index - 1]!), 'stop_sequence non crescente.');
    check(pattern[2] === null || (ints(pattern[2]) && pattern[2].length === pattern[0].length), 'Codici salita/discesa non validi.');
  }
  for (const vector of vectors) {
    check(Array.isArray(vector) && ints(vector[0]) && vector[0][0] === 0 && vector[0].every(step => step >= 0), 'Vettore orario non monotono.');
    check(vector[1] === null || (ints(vector[1]) && vector[1].length === vector[0].length && vector[1].every(step => step >= 0)), 'Soste non valide.');
    const { arrivals, departures } = decodeVector(vector);
    check(departures.every((departure, index) => index === departures.length - 1 || departure <= arrivals[index + 1]!) && departures.at(-1)! <= 48 * 3600, 'Partenza successiva all’arrivo seguente.');
  }
  check(headsigns.every(isString) && pkg.shapes.every(isString), 'Destinazione o percorso non validi.');
  const columns = ['trip_id', 'route', 'service', 'pattern', 'vector', 'start', 'headsign', 'direction', 'shape'] as const;
  check(columns.every(column => Array.isArray(trips[column]) && trips[column].length === count), 'Colonne delle corse non allineate.');
  check(trips.trip_id.every(isString) && new Set(trips.trip_id).size === count, 'Identificativi corsa duplicati.');
  for (let index = 0; index < count; index++) {
    const pattern = patterns[trips.pattern[index]!]; const vector = vectors[trips.vector[index]!];
    check(isInt(trips.route[index]) && routes[trips.route[index]!] && isInt(trips.service[index]) && services[trips.service[index]!] && pattern && vector
      && isInt(trips.headsign[index]) && headsigns[trips.headsign[index]!] !== undefined && isInt(trips.direction[index]) && isInt(trips.shape[index]) && pkg.shapes[trips.shape[index]!] !== undefined, `Riferimenti non validi per la corsa ${trips.trip_id[index]}.`);
    check(vector[0].length === pattern[0].length, `Orari e fermate non allineati per la corsa ${trips.trip_id[index]}.`);
    check(isInt(trips.start[index]) && trips.start[index]! >= 0 && trips.start[index]! <= 48 * 3600, `Inizio corsa non valido per ${trips.trip_id[index]}.`);
  }
  for (const frequency of frequencies) {
    check(ints(frequency) && frequency[0] >= 0 && frequency[0] < count && frequency[1] < frequency[2] && frequency[3] > 0 && (frequency[4] === 0 || frequency[4] === 1), 'Frequenza non valida.');
  }
  return pkg;
}

const HASH = /^[0-9a-f]{64}$/;
const ISO = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validateManifest(value: unknown): PackageManifest {
  const manifest = value as PackageManifest;
  check(manifest && typeof manifest === 'object' && manifest.schema_version === SCHEMA_VERSION && manifest.package_format === PACKAGE_FORMAT, 'Manifest orari non supportato.');
  check(HASH.test(manifest.package_hash) && HASH.test(manifest.source_zip_hash), 'Hash del manifest non valido.');
  check(manifest.package_path === `packages/gtt-${manifest.package_hash}.json`, 'Percorso del pacchetto non valido.');
  check(isInt(manifest.package_bytes) && manifest.package_bytes > 0 && manifest.package_bytes < 64 * 1024 * 1024, 'Dimensione del pacchetto non valida.');
  check(validDate(manifest.valid_from) && validDate(manifest.valid_to) && manifest.valid_from <= manifest.valid_to, 'Validità del manifest non valida.');
  check((manifest.upstream_checked_at === null || ISO(manifest.upstream_checked_at)) && ISO(manifest.built_at), 'Date del manifest non valide.');
  check(manifest.source_last_modified === undefined || manifest.source_last_modified === null || ISO(manifest.source_last_modified), 'Data della fonte non valida.');
  check(isString(manifest.feed_version) && isString(manifest.attribution) && manifest.attribution.includes('GTT'), 'Attribuzione del manifest mancante.');
  return manifest;
}

/** The package's own metadata must agree with the manifest that announced it. */
export function checkManifestMatchesPackage(manifest: PackageManifest, pkg: TimetablePackage) {
  check(manifest.feed_version === pkg.feed.feed_version && manifest.valid_from === pkg.feed.valid_from && manifest.valid_to === pkg.feed.valid_to, 'Il pacchetto non corrisponde al manifest.');
  check(manifest.counts.trips === pkg.trips.trip_id.length && manifest.counts.stops === pkg.stops.length && manifest.counts.patterns === pkg.patterns.length, 'Conteggi del pacchetto diversi dal manifest.');
}

const VERSION = /^\d+$/;
/**
 * Order two packages by their GTT source generation, independently of when they were built:
 * feed_version (numeric, e.g. 20261101), then the upstream Last-Modified time. Returns >0 when
 * `a` is a newer source than `b`, <0 when older, 0 when the same or indistinguishable.
 */
export function compareSource(a: PackageManifest, b: PackageManifest): number {
  if (a.feed_version !== b.feed_version && VERSION.test(a.feed_version) && VERSION.test(b.feed_version)) {
    const [left, right] = [a.feed_version.replace(/^0+/, ''), b.feed_version.replace(/^0+/, '')];
    if (left !== right) return left.length !== right.length ? Math.sign(left.length - right.length) : left > right ? 1 : -1;
  }
  if (a.source_zip_hash === b.source_zip_hash) return 0;
  const [left, right] = [Date.parse(a.source_last_modified ?? ''), Date.parse(b.source_last_modified ?? '')];
  return Number.isFinite(left) && Number.isFinite(right) && left !== right ? Math.sign(left - right) : 0;
}
/** A candidate may replace the active package only with a newer source, or the same source rebuilt later. */
export function isUpgrade(candidate: PackageManifest, active: PackageManifest): boolean {
  const order = compareSource(candidate, active);
  return order !== 0 ? order > 0 : Date.parse(candidate.built_at) > Date.parse(active.built_at);
}
