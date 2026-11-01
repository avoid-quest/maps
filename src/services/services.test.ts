import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '../domain/types';
import { deduplicatePlaces, searchLocalPlaces, searchPlaces } from './search';
import { getNearbyStops } from './transit';
import { parseRoadRoute, parseTransitRoute, roadRouteURL, romeDateTime } from './routing';
import { decodePolyline, TURIN_CENTER } from './geo';
import { fetchJSON, requestQueue, ServiceError } from './network';
const now = Date.UTC(2026, 9, 11, 14, 0);
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
  const work = () => queue(async () => { assert.equal(active++, 0); starts.push(performance.now()); await new Promise(r => setTimeout(r, 5)); active--; });
  // Callback sampling follows deadline assignment; injected-clock tests enforce exact boundaries.
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

