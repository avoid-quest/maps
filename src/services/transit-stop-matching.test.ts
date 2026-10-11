import test from 'node:test';
import assert from 'node:assert/strict';
import staticStops from '../data/gtt-stops.json';
import type { Coordinate, RouteStop, Stop } from '../domain/types';
import { createJourneyStopMatcher, matchJourneyStop } from './transit-stop-matching';

const lingotto = (staticStops as Stop[]).find(stop => stop.code === '2603')!;
const routeStop = (stop: Stop): RouteStop => ({ id: `mato:gtt:${stop.code}`, code: stop.code, name: stop.name, coordinate: stop.coordinate });

test('public codes resolve the installed internal IDs, including the Lingotto/Ancina collision', () => {
  assert.equal(matchJourneyStop(routeStop(lingotto))?.id, '1765');
  assert.match((staticStops as Stop[]).find(stop => stop.id === '2603')!.name, /ANCINA/);
  const garrone = (staticStops as Stop[]).find(stop => stop.code === '488')!;
  assert.equal(matchJourneyStop(routeStop(garrone))?.id, '3035');
});

test('matching rejects unknown namespaces, absent codes, internal IDs, and normalized identity variants', () => {
  for (const patch of [
    { id: 'gtt:2603' }, { id: 'mato:2:2603' }, { id: 'mato:rail:2603' }, { id: '2603' },
    { id: 'mato:gtt:1765' }, { id: 'mato:gtt:02603' }, { id: 'mato:gtt:2603 ' }, { code: '02603' },
    { id: 'mato:gtt:2603\n' }, { id: 'mato:gtt:2603\r\n' },
    { code: undefined }, { code: '2603 ' }, { code: '1765' }, { id: 'mato:gtt:99999999', code: '99999999' },
  ]) assert.equal(matchJourneyStop({ ...routeStop(lingotto), ...patch }), null, JSON.stringify(patch));
  assert.equal(matchJourneyStop(undefined), null);
});

test('duplicate public codes cannot be rescued by names, coordinates, or internal IDs', () => {
  const match = createJourneyStopMatcher([lingotto, { ...lingotto, id: 'other', coordinate: { latitude: 46, longitude: 8 } }]);
  assert.equal(match(routeStop(lingotto)), null);
});

test('both provider and installed coordinates must exist and be finite and within latitude/longitude bounds', () => {
  const invalid = [undefined, { latitude: NaN, longitude: 7 }, { latitude: 45, longitude: Infinity }, { latitude: 90.1, longitude: 7 }, { latitude: 45, longitude: -180.1 }];
  for (const coordinate of invalid) {
    assert.equal(matchJourneyStop({ ...routeStop(lingotto), coordinate }), null);
    const match = createJourneyStopMatcher([{ ...lingotto, coordinate: coordinate as Coordinate }]);
    assert.equal(match(routeStop(lingotto)), null);
  }
});

test('the ten-metre check accepts 9.9m and rejects 10.1m without a proximity fallback', () => {
  const shifted = (meters: number) => ({ ...lingotto.coordinate, latitude: lingotto.coordinate.latitude + meters / 6_371_000 * 180 / Math.PI });
  assert.equal(matchJourneyStop({ ...routeStop(lingotto), coordinate: shifted(9.9) })?.id, '1765');
  assert.equal(matchJourneyStop({ ...routeStop(lingotto), coordinate: shifted(10.1) }), null);
  assert.equal(matchJourneyStop({ ...routeStop(lingotto), id: 'mato:gtt:488', code: '488' }), null);
});
