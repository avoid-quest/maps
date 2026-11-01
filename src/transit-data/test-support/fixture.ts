import { createHash } from 'node:crypto';
import type { PackageManifest, TimetablePackage } from '../package-format';
import { createMemoryReader, datasetMeta } from '../reader';

/**
 * Synthetic package covering 20261020–20261130 (the 25 Oct DST change included). Padding stops,
 * routes, services and trips satisfy the production size floors without changing behaviour.
 *
 * - P0 tram 4: A(seq 1) B(3) C(7) D(9), timing 0/120/300/540 s
 * - P1 bus 10: A(1) B(2) A(3) E(4) — a repeated visit to A; dwell 30 s at B
 * - P2 metro M1: M1 M2 M3
 * - P4 tram 4 with a drop-off-only visit at B
 */
export function fixturePackage(options: { feedVersion?: string; tripPrefix?: string } = {}): TimetablePackage {
  const prefix = options.tripPrefix ?? '';
  const stops: TimetablePackage['stops'] = [
    ['A', '101', 'Fermata 101 - ALFA', 45.07, 7.68, '', 0], ['B', '102', 'Fermata 102 - BETA', 45.071, 7.681, '', 0],
    ['C', '103', 'Fermata 103 - GAMMA', 45.072, 7.682, '', 0], ['D', '104', 'Fermata 104 - DELTA', 45.073, 7.683, '', 0],
    ['E', '105', 'Fermata 105 - EPSILON', 45.074, 7.684, '', 0],
    ['M1', '8210', 'FERMI', 45.075, 7.6, '', 0], ['M2', '8211', 'PARADISO', 45.076, 7.61, '', 0], ['M3', '8212', 'POZZO STRADA', 45.077, 7.62, '', 0],
  ];
  for (let index = 0; index < 1000; index++) stops.push([`F${index}`, `9${index}`, `Filler ${index}`, 45 + index / 100_000, 7.5, '', 0]);
  const routes: TimetablePackage['routes'] = [['10U', 'U', 3, '10', 'Bus 10'], ['4U', 'U', 0, '4', 'Tram 4'], ['METROU', 'U', 1, 'M1', 'Metro']];
  for (let index = 0; index < 50; index++) routes.push([`R${index}`, 'U', 3, `R${index}`, 'Filler']);
  const services: TimetablePackage['services'] = [
    ['ALL', 127, '20261020', '20261130', [], []],
    ['HOL', 0, '', '', ['20261102'], []],
    ['WK', 31, '20261020', '20261130', [], ['20261102']],
  ];
  for (let index = 0; index < 10; index++) services.push([`S${index}`, 0, '', '', [], []]);
  const stopIndex = (id: string) => stops.findIndex(stop => stop[0] === id);
  const patterns: TimetablePackage['patterns'] = [
    [['A', 'B', 'C', 'D'].map(stopIndex), [1, 3, 7, 9], null],
    [['A', 'B', 'A', 'E'].map(stopIndex), [1, 2, 3, 4], null],
    [['M1', 'M2', 'M3'].map(stopIndex), [1, 2, 3], null],
    [[stopIndex('F0'), stopIndex('F1')], [1, 2], null],
    [['A', 'B', 'C'].map(stopIndex), [1, 2, 3], [0, 4, 0]],
  ];
  const vectors: TimetablePackage['vectors'] = [[[0, 120, 180, 240], null], [[0, 60, 60, 60], [0, 30, 0, 0]], [[0, 90, 90], null], [[0, 60], null]];
  const headsigns = ['DELTA', 'EPSILON', 'BENGASI', 'FILLER', 'GAMMA'];
  const trips: TimetablePackage['trips'] = { trip_id: [], route: [], service: [], pattern: [], vector: [], start: [], headsign: [], direction: [], shape: [] };
  const shapes = ['', '4A', '10A', 'M1A', '4D'];
  const shapeFor = (routeId: string, pattern: number) => routeId === '4U' ? (pattern === 4 ? 4 : 1) : routeId === '10U' ? 2 : routeId === 'METROU' ? 3 : 0;
  const route = (id: string) => routes.findIndex(entry => entry[0] === id);
  const service = (id: string) => services.findIndex(entry => entry[0] === id);
  const add = (id: string, routeId: string, serviceId: string, pattern: number, vector: number, start: number, headsign: number) => {
    trips.trip_id.push(id); trips.route.push(route(routeId)); trips.service.push(service(serviceId)); trips.pattern.push(pattern);
    trips.vector.push(vector); trips.start.push(start); trips.headsign.push(headsign); trips.direction.push(0); trips.shape.push(shapeFor(routeId, pattern));
  };
  add(`${prefix}T1`, '4U', 'ALL', 0, 0, 8 * 3600, 0);
  add(`${prefix}T2`, '4U', 'WK', 0, 0, 8 * 3600 + 600, 0);
  add(`${prefix}HOL1`, '4U', 'HOL', 0, 0, 8 * 3600 + 1200, 0);
  add(`${prefix}TLATE`, '4U', 'ALL', 0, 0, 25 * 3600 + 1800, 0);
  add(`${prefix}L1`, '10U', 'ALL', 1, 1, 9 * 3600, 1);
  add(`${prefix}MET1`, 'METROU', 'ALL', 2, 2, 8 * 3600 + 300, 2);
  add(`${prefix}DROP1`, '4U', 'ALL', 4, 2, 10 * 3600, 4);
  add(`${prefix}FQ`, '4U', 'ALL', 0, 0, 12 * 3600, 0);
  add(`${prefix}FQX`, '4U', 'ALL', 0, 0, 14 * 3600, 0);
  for (let index = 0; index < 5000; index++) add(`${prefix}X${String(index).padStart(5, '0')}`, `R${index % 50}`, `S${index % 10}`, 3, 3, 6 * 3600 + index, 3);
  const fq = trips.trip_id.indexOf(`${prefix}FQ`); const fqx = trips.trip_id.indexOf(`${prefix}FQX`);
  return {
    format: 'avoid-maps.gtt-timetable', schema_version: 2,
    feed: { feed_version: options.feedVersion ?? '20261019', valid_from: '20261020', valid_to: '20261130', timezone: 'Europe/Rome', publisher: 'Fixture' },
    agencies: [['U', 'Urbano']], routes, stops, services, patterns, vectors, headsigns, shapes, trips,
    frequencies: [[fq, 12 * 3600, 13 * 3600, 600, 0], [fqx, 14 * 3600, 14 * 3600 + 1800, 600, 1]],
  };
}

export function encodePackage(pkg: TimetablePackage): string { return `${JSON.stringify(pkg)}\n`; }

export function fixtureManifest(text: string, pkg: TimetablePackage, overrides: Partial<PackageManifest> = {}): PackageManifest {
  const hash = createHash('sha256').update(text).digest('hex');
  return {
    schema_version: 2, package_format: 'avoid-maps.gtt-timetable', package_hash: hash, package_bytes: text.length,
    package_path: `packages/gtt-${hash}.json`, feed_version: pkg.feed.feed_version, valid_from: pkg.feed.valid_from, valid_to: pkg.feed.valid_to,
    source_url: 'https://www.gtt.to.it/open_data/gtt_gtfs.zip', source_zip_hash: createHash('sha256').update(`zip:${pkg.feed.feed_version}`).digest('hex'), source_last_modified: '2026-10-19T02:26:59Z', source_etag: '"x"',
    upstream_checked_at: '2026-10-19T03:15:00Z', built_at: '2026-10-19T03:15:00Z',
    attribution: 'Data source: GTT S.p.A. – Gruppo Torinese Trasporti', attribution_url: 'https://www.gtt.to.it', licence_url: 'https://www.gtt.to.it/gtt_gtfs_license.html',
    builder_version: '1', counts: { stops: pkg.stops.length, routes: pkg.routes.length, trips: pkg.trips.trip_id.length, patterns: pkg.patterns.length, vectors: pkg.vectors.length, services: pkg.services.length },
    previous: [], ...overrides,
  };
}

export function fixtureReader(pkg = fixturePackage()) {
  const text = encodePackage(pkg); const manifest = fixtureManifest(text, pkg);
  return createMemoryReader(pkg, datasetMeta(pkg, manifest, 'bundled'));
}

/** Epoch ms for a Rome civil time (fixture dates are unambiguous). */
export function rome(date: string, time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6), hour!, minute!);
  for (const offset of [1, 2]) {
    const candidate = guess - offset * 3_600_000;
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(candidate));
    if (local === time) return candidate;
  }
  throw new Error(`no Rome time ${date} ${time}`);
}
