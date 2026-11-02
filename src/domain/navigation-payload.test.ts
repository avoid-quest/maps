import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTransitRoutes, type MatoResponse } from '../services/routing';
import { createSavedTravel } from '../services/saved-travel';
import { guidanceStart } from '../features/planner/transit-journey';
import { BridgePayloadError, bridgeSafetyProblem, nativeRoadStart, nativeTransitPlan, nativeTransitStart } from './navigation-payload';

const T = Date.parse('2026-11-02T11:00:00Z');
const at = (minutes: number) => T + minutes * 60_000;
const place = (name: string, lat: number, lon: number, code?: string) => ({ name, lat, lon, stop: code ? { gtfsId: `gtt:${code}`, name, code, platformCode: null } : null });
// A Politecnico-style MATO answer: access walk, bus 10N, transfer walk, bus 68 (public stops; synthetic times).
const mato: MatoResponse = { data: { plan: { itineraries: [{
  duration: 1800, startTime: at(0), endTime: at(30), walkTime: 600, walkDistance: 700, waitingTime: 0,
  legs: [
    { mode: 'WALK', transitLeg: false, duration: 240, distance: 300, realTime: false, realtimeState: null, interlineWithPreviousLeg: false, startTime: at(0), endTime: at(4),
      route: null, trip: null, from: place('Origin', 45.07, 7.68), to: place('PORTA NUOVA', 45.062, 7.678, '1'), legGeometry: { points: '_p~iF~ps|U_ulLnnqC' } },
    { mode: 'BUS', transitLeg: true, duration: 600, distance: 2500, realTime: false, realtimeState: 'SCHEDULED', interlineWithPreviousLeg: false, startTime: at(5), endTime: at(15),
      departureDelay: 0, arrivalDelay: 0, serviceDate: '20261102', route: { shortName: '10N', longName: null }, trip: { gtfsId: 'gtt:1U', tripHeadsign: null },
      from: place('PORTA NUOVA', 45.062, 7.678, '1'), to: place('POLITECNICO', 45.063, 7.66, '2'), intermediatePlaces: [], legGeometry: { points: '_p~iF~ps|U_ulLnnqC' } },
    { mode: 'WALK', transitLeg: false, duration: 120, distance: 100, realTime: false, realtimeState: null, interlineWithPreviousLeg: false, startTime: at(15), endTime: at(17),
      route: null, trip: null, from: place('POLITECNICO', 45.063, 7.66, '2'), to: place('BOTTA', 45.064, 7.659, '3'), legGeometry: null },
    { mode: 'BUS', transitLeg: true, duration: 600, distance: 2000, realTime: true, realtimeState: 'UPDATED', interlineWithPreviousLeg: false, startTime: at(18), endTime: at(28),
      departureDelay: 60, arrivalDelay: 60, serviceDate: '20261102', route: { shortName: '68', longName: null }, trip: { gtfsId: 'gtt:2U', tripHeadsign: 'CAPPUCCINI' },
      from: place('BOTTA', 45.064, 7.659, '3'), to: place('CASTELLO', 45.07, 7.686, '4'),
      intermediatePlaces: [{ name: 'X', arrivalTime: at(20), lat: 45.065, lon: 7.66, stop: { gtfsId: 'gtt:5', name: 'X', code: '5', platformCode: null } }], legGeometry: { points: '_p~iF~ps|U_ulLnnqC' } },
    { mode: 'WALK', transitLeg: false, duration: 120, distance: 300, realTime: false, realtimeState: null, interlineWithPreviousLeg: false, startTime: at(28), endTime: at(30),
      route: null, trip: null, from: place('CASTELLO', 45.07, 7.686, '4'), to: place('Destination', 45.071, 7.687), legGeometry: { points: '_p~iF~ps|U_ulLnnqC' } },
  ],
}] } } };
const endpoints = { origin: { latitude: 45.07, longitude: 7.68 }, destination: { latitude: 45.071, longitude: 7.687 } };

test('root cause: the UI plan carries undefined fields, which the Expo bridge cannot convert', () => {
  const [plan] = parseTransitRoutes(mato, T);
  const start = guidanceStart('transit', plan!, false, endpoints);
  assert.equal(start?.kind, 'transit');
  // Exactly what startTransitNavigation used to send: walk legs have line/headsign/tripId === undefined.
  assert.match(bridgeSafetyProblem(start!.options) ?? '', /^payload\.plan\.legs\[0\]\.line: undefined$/);
});

test('the native transit payload is bridge-safe and carries exactly what TransitJourneyEngine reads', () => {
  const [plan] = parseTransitRoutes(mato, T);
  const start = guidanceStart('transit', plan!, false, endpoints)!;
  assert.equal(start.kind, 'transit');
  const payload = nativeTransitStart(start.kind === 'transit' ? start.options : (undefined as never));
  assert.equal(bridgeSafetyProblem(payload), null);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload, 'JSON round trip (native checkpoint) changes nothing');
  assert.deepEqual(Object.keys(payload), ['plan', 'origin', 'destination']);
  assert.deepEqual(Object.keys(payload.plan), ['mode', 'fetchedAt', 'source', 'geometry', 'legs']);
  assert.equal(payload.plan.fetchedAt, T, 'the follow screen matches the session by retrieval time');
  assert.equal(payload.plan.legs.length, plan!.legs.length, 'and by leg count');
  const walk = payload.plan.legs[0]!;
  assert.deepEqual(Object.keys(walk).sort(), ['arrivalAt', 'departureAt', 'distanceMeters', 'durationSeconds', 'from', 'geometry', 'interlineWithPreviousLeg', 'mode', 'timingStatus', 'to', 'toStop', 'transitLeg']);
  const bus = payload.plan.legs[3]!;
  assert.equal(bus.line, '68');
  assert.equal(bus.headsign, 'CAPPUCCINI');
  assert.deepEqual(bus.fromStop, { coordinate: { latitude: 45.064, longitude: 7.659 } });
  assert.equal('intermediateStops' in bus, false);
  assert.equal('scheduledDepartureAt' in bus, false);
  assert.equal(payload.plan.legs[1]!.headsign, undefined, 'an absent headsign is omitted, not sent');
  assert.equal('headsign' in payload.plan.legs[1]!, false);
  for (const leg of payload.plan.legs) assert.ok(leg.departureAt > 0 && leg.arrivalAt >= leg.departureAt);
});

test('a journey restored from saved travel is also sent bridge-safe', async () => {
  const [plan] = parseTransitRoutes(mato, T);
  const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } };
  const store = createSavedTravel({ now: () => T + 1000 });
  await store.initialize(storage);
  assert.equal(await store.saveJourney({ query: { from: endpoints.origin, to: endpoints.destination, mode: 'transit', transitTime: { kind: 'now' } }, originLabel: 'A', destinationLabel: 'B', plan: plan! }), true);
  const reloaded = createSavedTravel();
  await reloaded.initialize(storage);
  const restored = reloaded.getSnapshot().journey!.plan;
  assert.notEqual(bridgeSafetyProblem({ plan: restored }), null, 'the saved copy keeps undefined optional fields too');
  assert.equal(bridgeSafetyProblem(nativeTransitStart({ plan: restored, ...endpoints })), null);
  assert.deepEqual(nativeTransitPlan(restored), nativeTransitPlan(plan!));
});

test('road Start sends only the destination point and mode; unsafe values never reach the bridge', () => {
  const destination = Object.assign({ latitude: 45.07, longitude: 7.68 }, { accuracy: undefined, label: null });
  assert.deepEqual(nativeRoadStart({ destination, mode: 'walk' }), { destination: { latitude: 45.07, longitude: 7.68 }, mode: 'walk' });
  assert.throws(() => nativeRoadStart({ destination: { latitude: Number.NaN, longitude: 7 }, mode: 'walk' }), BridgePayloadError);
  const [plan] = parseTransitRoutes(mato, T);
  assert.throws(() => nativeTransitStart({ plan: { ...plan!, fetchedAt: Number.POSITIVE_INFINITY }, ...endpoints }), (error: unknown) => error instanceof BridgePayloadError && error.code === 'invalid');
  assert.match(bridgeSafetyProblem({ when: new Date(0) }) ?? '', /Date instance/);
  assert.match(bridgeSafetyProblem({ list: [1, null] }) ?? '', /list\[1\]: null/);
  assert.match(bridgeSafetyProblem({ call: () => 1 }) ?? '', /function/);
  assert.match(bridgeSafetyProblem([1, , 3]) ?? '', /hole/);
});

test('road and walking-only plans never produce a transit Start, and the platform sends the explicit payloads', () => {
  const [plan] = parseTransitRoutes(mato, T);
  assert.equal(guidanceStart('walk', plan!, false, endpoints), null);
  assert.equal(guidanceStart('transit', plan!, true, endpoints), null);
  assert.equal(guidanceStart('transit', { ...plan!, legs: plan!.legs.filter(leg => !leg.transitLeg) }, false, endpoints), null);
  const source = readFileSync(new URL('../platform/navigation.ts', import.meta.url), 'utf8');
  assert.match(source, /startNavigation\(nativeRoadStart\(options\)\)/);
  assert.match(source, /startTransitNavigation\(nativeTransitStart\(options\)\)/);
});
