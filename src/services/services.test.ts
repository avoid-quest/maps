import test from 'node:test';
import assert from 'node:assert/strict';
import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import type { Place } from '../domain/types';
import { deduplicatePlaces, searchLocalPlaces, searchPlaces } from './search';
import { departuresFromFeed, predictionStatus, getNearbyStops, getDepartures, type RTFeed, type TripLookup } from './transit';
import { parseRoadRoute, parseTransitRoute, roadRouteURL, romeDateTime } from './routing';
import { decodePolyline, TURIN_CENTER } from './geo';
import { fetchJSON, requestQueue, ServiceError } from './network';
const now = Date.UTC(2026, 9, 11, 14, 0); const sec = (n: number) => n / 1000;
const index: TripLookup = { trips: { t: ['4', 'Falchera', '4U', 0] }, patterns: [{ '12': '6', '13': '10' }] };
function feed(relationship?: string): RTFeed { return { header: { timestamp: sec(now) }, entity: [{ tripUpdate: { timestamp: sec(now - 30_000), trip: { tripId: 't' }, stopTimeUpdate: [{ stopSequence: 12, scheduleRelationship: relationship, arrival: { time: sec(now + 180_000) } }] } }] }; }
test('GTFS-RT decoded protobuf joins actual stop_sequence, never public stop code', () => {
  const type = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
  const bytes = type.encode(type.fromObject({ ...feed(), header: { gtfsRealtimeVersion: '2.0', timestamp: sec(now) } })).finish();
  const decoded = type.toObject(type.decode(bytes), { longs: Number, enums: String }) as RTFeed;
  assert.equal(departuresFromFeed(decoded, '6', now, index).departures[0]?.line, '4');
  assert.equal(departuresFromFeed(decoded, '10', now, index).departures.length, 0);
});
test('fresh feed does not turn stale/unknown entity into a live arrival', () => {
  assert.equal(predictionStatus(now, now - 121_000, now), 'stale');
  assert.equal(predictionStatus(now, undefined, now), 'unknown');
  assert.equal(predictionStatus(now, now + 100_000, now), 'unknown');
  assert.equal(predictionStatus(now, now - 30_000, now), 'live');
});
test('skipped, NO_DATA, and cancelled trips retain honest statuses', () => {
  assert.equal(departuresFromFeed(feed('SKIPPED'), '6', now, index).departures[0]?.status, 'cancelled');
  assert.equal(departuresFromFeed(feed('NO_DATA'), '6', now, index).departures[0]?.status, 'unknown');
  const cancelled: RTFeed = { header: { timestamp: sec(now) }, entity: [{ tripUpdate: { timestamp: sec(now), trip: { tripId: 't', scheduleRelationship: 'CANCELED' } } }] };
  assert.equal(departuresFromFeed(cancelled, '6', now, index).departures[0]?.status, 'cancelled');
});
test('unmatched trips and empty feed report absence, never scheduled-on-time fiction', () => {
  const result = departuresFromFeed(feed(), '6', now, { trips: {}, patterns: [] });
  assert.deepEqual(result.departures, []); assert.ok(result.warnings.some(w => w.includes('non corrispondono')));
  assert.throws(() => departuresFromFeed({ header: { incrementality: 'DIFFERENTIAL' } }, '6', now, index));
});
test('Italian search finds real independent local shops and food', () => {
  assert.ok(searchLocalPlaces('hamburger', TURIN_CENTER).length > 0);
  assert.ok(searchLocalPlaces('supermercato', TURIN_CENTER).some(p => /lidl/i.test(p.name)));
  assert.ok(searchLocalPlaces('Hangar 107', TURIN_CENTER).some(p => /hangar/i.test(p.name)));
  assert.ok(getNearbyStops(TURIN_CENTER).length > 0);
});
test('duplicate names nearby merge; independent businesses at same address survive', () => {
  const place: Place = { id: 'a', name: 'Amen Bar', coordinate: TURIN_CENTER, source: 'Overture', attributions: ['a'] };
  const result = deduplicatePlaces([place, { ...place, id: 'b', name: 'AMEN BAR', source: 'OSM', attributions: ['b'] }, { ...place, id: 'c', name: 'Burgheria' }]);
  assert.equal(result.length, 2); assert.deepEqual(result[0]?.attributions, ['a', 'b']);
});
test('road transport selection uses separate service, generic driving path remains', () => {
  for (const [mode, path] of [['walk', 'routed-foot'], ['bicycle', 'routed-bike'], ['car', 'routed-car']] as const) assert.ok(roadRouteURL(TURIN_CENTER, TURIN_CENTER, mode).includes(`/${path}/route/v1/driving/`));
  assert.throws(() => parseRoadRoute({ code: 'NoRoute', routes: [] }, 'walk'));
});
test('transit source realtime flags and empty itineraries preserved', () => {
  const route = parseTransitRoute({ data: { plan: { itineraries: [{ duration: 500, legs: [{ mode: 'BUS', duration: 500, distance: 1200, realTime: false, startTime: now, endTime: now + 500_000, route: { shortName: '4' }, from: { name: 'A' }, to: { name: 'B' } }] }] } } });
  assert.equal(route.legs[0]?.realTime, false); assert.ok(route.warnings.some(w => w.includes('programmati')));
  assert.throws(() => parseTransitRoute({ data: { plan: { itineraries: [] } } }));
});
test('Rome date/time accounts for midnight and DST independently of phone timezone', () => {
  assert.deepEqual(romeDateTime(new Date('2026-10-11T22:30:00Z')), { date: '2026-10-12', time: '00:30:00' });
  assert.deepEqual(romeDateTime(new Date('2026-10-25T01:30:00Z')), { date: '2026-10-25', time: '02:30:00' });
});
test('geometry parser decodes route and rejects truncation', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')[0], { latitude: 38.5, longitude: -120.2 });
  assert.throws(() => decodePolyline('_'));
});
test('provider queue serializes requests and skips cancelled work', async () => {
  const queue = requestQueue(20); const starts: number[] = []; let active = 0;
  const work = () => queue(async () => { assert.equal(active++, 0); starts.push(Date.now()); await new Promise(r => setTimeout(r, 5)); active--; });
  await Promise.all([work(), work()]); assert.ok(starts[1]! - starts[0]! >= 18);
  const controller = new AbortController(); controller.abort(); await assert.rejects(queue(async () => { throw new Error('must not execute'); }, controller.signal), { name: 'AbortError' });
});
test('HTTP and offline failures are errors; local results are labelled fallback', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response('', { status: 429 });
    await assert.rejects(fetchJSON('https://example.test'), (e: unknown) => e instanceof ServiceError && e.kind === 'rate-limit');
    global.fetch = async () => { throw new Error('offline'); };
    const local = await searchPlaces('Hangar 107', { center: TURIN_CENTER });
    assert.ok(local.places.length); assert.ok(local.warnings.length);
    await assert.rejects(searchPlaces('zxq-no-such-place', { center: TURIN_CENTER }), ServiceError);
  } finally { global.fetch = original; }
});

test('valid 200 GTFS feed with zero entities is an empty board, not malformed data', async () => {
  const original = global.fetch;
  const type = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
  const bytes = type.encode(type.fromObject({ header: { gtfsRealtimeVersion: '2.0', timestamp: Math.floor(Date.now() / 1000) }, entity: [] })).finish();
  try {
    global.fetch = async () => new Response(bytes as unknown as BodyInit);
    const stop = getNearbyStops(TURIN_CENTER)[0]!;
    const board = await getDepartures(stop.id);
    assert.equal(board.departures.length, 0);
    assert.ok(board.warnings.some(w => w.includes('Nessuna previsione')));
  } finally { global.fetch = original; }
});
