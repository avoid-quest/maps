import test from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinate } from '../domain/types';
import { parseRoadRoute, parseTransitRoute, parseTransitRoutes, planRoute, planRoutes, type MatoItinerary, type MatoLeg, type MatoResponse } from './routing';
import { ServiceError } from './network';
import { emptyRouteState, routeReducer } from '../components/route-state';

const start = Date.parse('2026-10-12T07:00:00Z');
const fetchedAt = Date.parse('2026-10-11T12:00:00Z');
const from: Coordinate = { latitude: 45.07, longitude: 7.68 };
const to: Coordinate = { latitude: 45.03, longitude: 7.66 };
const point = (name: string, id?: string, code?: string) => ({
  name, lat: 45.07, lon: 7.68,
  stop: id ? { gtfsId: id, name, code, platformCode: '2' } : null,
});
function leg(mode: string, first: number, last: number, trip?: string): MatoLeg {
  return {
    mode, transitLeg: !!trip, duration: (last - first) * 60, distance: (last - first) * 100,
    startTime: start + first * 60_000, endTime: start + last * 60_000,
    realTime: false, realtimeState: 'SCHEDULED', interlineWithPreviousLeg: false,
    serviceDate: trip ? '20261012' : undefined,
    trip: trip ? { gtfsId: `gtt:${trip}`, tripHeadsign: 'GRAN MADRE' } : null,
    route: trip ? { shortName: '13', longName: 'Linea di esempio' } : null,
    from: point('PORTA SUSA', 'gtt:example-a', '1001'),
    to: point('PORTA NUOVA', 'gtt:example-b', '1002'),
    legGeometry: { points: '????' },
  };
}
function itinerary(): MatoItinerary {
  const legs = [leg('WALK', 0, 4), leg('TRAM', 6, 16, 'example-tram'), leg('WALK', 16, 18), leg('BUS', 23, 33, 'example-bus'), leg('WALK', 33, 36)];
  legs[0]!.from = point('Origin'); legs[4]!.to = point('Destination');
  return { duration: 2160, startTime: start, endTime: start + 2160_000, walkTime: 540, walkDistance: 900, waitingTime: 420, legs };
}
function response(...itineraries: MatoItinerary[]): MatoResponse { return { data: { plan: { itineraries } } }; }
function shiftTimes(value: MatoItinerary, seconds: number) {
  value.startTime! += seconds * 1000; value.endTime! += seconds * 1000;
  for (const item of value.legs) { item.startTime += seconds * 1000; item.endTime += seconds * 1000; }
  return value;
}

test('transit alternatives expose boarding, direction, arrival, source identity and transfer totals', () => {
  const first = itinerary(); const second = itinerary();
  second.legs[3]!.trip!.gtfsId = 'gtt:another-trip';
  const plans = parseTransitRoutes(response(first, second), fetchedAt);
  assert.equal(plans.length, 2); assert.notEqual(plans[0]!.id, plans[1]!.id);
  const plan = plans[0]!; const boarding = plan.legs[1]!;
  assert.equal(plan.departureAt, start); assert.equal(plan.arrivalAt, start + 2160_000);
  assert.equal(plan.walkingDurationSeconds, 540); assert.equal(plan.walkingDistanceMeters, 900);
  assert.equal(plan.waitingDurationSeconds, 420); assert.equal(plan.transferCount, 1);
  assert.equal(boarding.fromStop?.id, 'mato:gtt:example-a'); assert.equal(boarding.fromStop?.code, '1001');
  assert.deepEqual(boarding.fromStop?.coordinate, from); assert.equal(boarding.fromStop?.platformCode, '2');
  assert.equal(boarding.headsign, 'GRAN MADRE'); assert.equal(boarding.tripId, 'mato:gtt:example-tram');
  assert.equal(boarding.serviceDate, '20261012'); assert.equal(boarding.timingStatus, 'scheduled');
  assert.equal(plan.fetchedAt, fetchedAt); assert.equal(plan.legs[0]!.from, 'Partenza');
  assert.equal(plan.legs.at(-1)!.to, 'Destinazione');
  assert.equal(parseTransitRoute(response(first, second), fetchedAt).id, plan.id);
});

test('trip identity survives response reordering and prediction changes, and separates service days', () => {
  const first = itinerary(); const second = itinerary(); second.legs[3]!.trip!.gtfsId = 'gtt:other';
  const before = parseTransitRoutes(response(first, second), fetchedAt);
  const delayed = shiftTimes(structuredClone(first), 120);
  delayed.legs[1]!.realTime = true; delayed.legs[1]!.realtimeState = 'UPDATED';
  const after = parseTransitRoutes(response(second, delayed), fetchedAt + 300_000);
  assert.equal(before[0]!.id, after[1]!.id); assert.equal(before[1]!.id, after[0]!.id);
  assert.equal(before[0]!.legs[1]!.id, after[1]!.legs[1]!.id);
  assert.equal(after[1]!.legs[1]!.timingStatus, 'prediction');
  const nextDay = shiftTimes(structuredClone(first), 86_400);
  for (const item of nextDay.legs) if (item.trip) item.serviceDate = '20261013';
  assert.notEqual(parseTransitRoute(response(nextDay)).id, before[0]!.id);
  assert.equal(parseTransitRoutes(response(first, structuredClone(first))).length, 1);
});

test('refresh preserves the selected trip after delays and reordering when stop IDs are missing', () => {
  for (const missing of [['from'], ['to'], ['from', 'to']] as const) {
    const selected = itinerary();
    for (const endpoint of missing) delete selected.legs[1]![endpoint].stop!.gtfsId;
    const other = itinerary(); other.legs[3]!.trip!.gtfsId = 'gtt:unrelated';
    const before = parseTransitRoutes(response(selected, other), fetchedAt);
    let state = routeReducer(emptyRouteState, { type: 'start', queryKey: 'journey', request: 1 });
    state = routeReducer(state, { type: 'success', queryKey: 'journey', request: 1, plans: before });

    const delayed = shiftTimes(structuredClone(selected), 120);
    delayed.legs[1]!.realTime = true; delayed.legs[1]!.realtimeState = 'UPDATED';
    const after = parseTransitRoutes(response(other, delayed), fetchedAt + 300_000);
    state = routeReducer(state, { type: 'start', queryKey: 'journey', request: 2 });
    state = routeReducer(state, { type: 'success', queryKey: 'journey', request: 2, plans: after });
    assert.ok(state.selectedId === after[1]!.id, 'Refresh must retain the selected trip instead of selecting the unrelated first alternative');
    assert.equal(before[0]!.legs[1]!.id, after[1]!.legs[1]!.id);
    assert.equal(after[1]!.legs[1]!.timingStatus, 'prediction');

    const differentStop = structuredClone(selected);
    differentStop.legs[1]![missing[0]].name = 'Altra fermata';
    differentStop.legs[1]![missing[0]].stop!.code = '9999';
    assert.equal(parseTransitRoutes(response(selected, differentStop)).length, 2);
  }
});

test('stay-aboard legs do not add a transfer; walking breaks an interline continuation', () => {
  const first = leg('TRAM', 0, 10, 'first'); const second = leg('BUS', 12, 22, 'second');
  second.interlineWithPreviousLeg = true;
  const staying = parseTransitRoute(response({ duration: 1320, legs: [first, second] }));
  assert.equal(staying.transferCount, 0); assert.equal(staying.legs[1]!.interlineWithPreviousLeg, true);
  assert.equal(staying.waitingDurationSeconds, 120);
  const changing = parseTransitRoute(response({ duration: 1320, legs: [first, leg('WALK', 10, 11), second] }));
  assert.equal(changing.transferCount, 1); assert.equal(changing.legs[2]!.interlineWithPreviousLeg, false);
  assert.equal(changing.waitingDurationSeconds, 60);
});

test('cancelled and unknown source states never become predictions or fabricated schedules', () => {
  for (const [state, realtime, expected] of [
    ['CANCELED', true, 'cancelled'], ['CANCELLED', false, 'cancelled'], ['NO_DATA', true, 'unknown'],
    ['UPDATED', true, 'prediction'], ['UPDATED', false, 'unknown'], ['SCHEDULED', false, 'scheduled'], ['SCHEDULED', true, 'unknown'],
    [undefined, undefined, 'unknown'], [undefined, false, 'scheduled'],
  ] as const) {
    const value = leg('BUS', 0, 10, 'trip'); value.realtimeState = state; value.realTime = realtime;
    const plan = parseTransitRoute(response({ duration: 600, legs: [value] }), fetchedAt);
    assert.equal(plan.legs[0]!.timingStatus, expected);
    assert.equal(plan.legs[0]!.realTime, expected === 'prediction');
    assert.equal(plan.fetchedAt, fetchedAt);
    if (expected === 'cancelled') assert.ok(plan.warnings.some(warning => warning.includes('cancellata')));
  }
});

test('partial identity preserves stop details without inventing a match and keeps different schedules', () => {
  const first = itinerary();
  delete first.legs[1]!.from.stop!.gtfsId; first.legs[1]!.trip = null;
  const second = shiftTimes(structuredClone(first), 600);
  const plans = parseTransitRoutes(response(first, second));
  assert.equal(plans.length, 2);
  assert.ok(plans[0]!.legs[1]!.fromStop?.id.startsWith('mato:unmatched:'));
  assert.equal(plans[0]!.legs[1]!.fromStop?.code, '1001');
  assert.equal(plans[0]!.legs[1]!.tripId, undefined);
});

test('all-walking alternatives distinguish geometry and schedule, with explicit absence of a vehicle', () => {
  const first = { duration: 600, legs: [leg('WALK', 0, 10)] };
  const second = structuredClone(first); second.legs[0]!.legGeometry!.points = '??AA';
  const third = structuredClone(first); third.legs[0]!.startTime += 60_000; third.legs[0]!.endTime += 60_000;
  const plans = parseTransitRoutes(response(first, second, third));
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    assert.equal(plan.transferCount, 0); assert.equal(plan.walkingDurationSeconds, 600);
    assert.ok(plan.warnings.some(warning => warning.includes('solo un percorso a piedi')));
    assert.equal(plan.legs[0]!.timingStatus, 'unknown');
  }
  const mixed = parseTransitRoutes(response(first, itinerary()));
  assert.ok(mixed[0]!.warnings.includes('Questa alternativa prevede solo un percorso a piedi.'));
  assert.ok(mixed.every(plan => plan.warnings.every(warning => !warning.includes('Nessun collegamento pubblico'))));
});

test('malformed alternatives cannot leak impossible times or geometry into otherwise valid results', () => {
  const corruptions: ((value: MatoItinerary) => void)[] = [
    value => { value.legs[1]!.endTime = value.legs[1]!.startTime - 1; },
    value => { value.legs[1]!.startTime = Number.NaN; },
    value => { value.legs[1]!.duration = -10; },
    value => { value.legs[1]!.duration = 9999; },
    value => { value.duration = 9999; },
    value => { value.legs[1]!.distance = Infinity; },
    value => { value.legs[1]!.legGeometry!.points = '_'; },
    value => { value.legs[1]!.legGeometry!.points = '!'; },
    value => { value.legs[1]!.from.name = ''; },
    value => { value.legs[1]!.startTime = start; },
    value => { value.walkTime = -1; },
    value => { value.legs = []; },
  ];
  for (const corrupt of corruptions) {
    const bad = itinerary(); corrupt(bad);
    assert.throws(() => parseTransitRoutes(response(bad)), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    const [valid] = parseTransitRoutes(response(bad, itinerary()));
    assert.ok(valid?.warnings.some(warning => warning.includes('dati non validi')));
  }
  assert.throws(() => parseTransitRoutes(response()), (error: unknown) => error instanceof ServiceError && error.kind === 'unavailable');
  assert.throws(() => parseTransitRoutes({ errors: [{ message: 'private provider details' }] }), (error: unknown) => error instanceof ServiceError && !error.message.includes('private'));
});

test('road wrappers retain one route with explicit walking totals and stable geometry identity', () => {
  const data = { code: 'Ok', routes: [{ distance: 100, duration: 80, geometry: { coordinates: [[7.68, 45.07], [7.69, 45.08]] as [number, number][] }, legs: [{ steps: [] }] }] };
  const walk = parseRoadRoute(data, 'walk'); const car = parseRoadRoute(data, 'car');
  assert.equal(walk.walkingDistanceMeters, 100); assert.equal(walk.walkingDurationSeconds, 80);
  assert.equal(car.walkingDistanceMeters, 0); assert.equal(car.transferCount, 0); assert.equal(car.waitingDurationSeconds, 0);
  assert.equal(parseRoadRoute(data, 'walk').id, walk.id); assert.notEqual(walk.id, car.id);
});

test('route requests send validated depart/arrive time and reject invalid or aborted work before fetch', async () => {
  const original = global.fetch; const queries: string[] = [];
  try {
    global.fetch = async (_url, init) => {
      queries.push((JSON.parse(init!.body as string) as { query: string }).query);
      return Response.json(response(itinerary()));
    };
    await assert.rejects(planRoutes({ from, to, mode: 'transit', transitTime: { kind: 'depart-at', date: '2026-03-29', time: '02:30' } }), ServiceError);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(planRoutes({ from, to, mode: 'transit', signal: controller.signal }), { name: 'AbortError' });
    assert.equal(queries.length, 0);
    const plans = await planRoutes({ from, to, mode: 'transit', transitTime: { kind: 'depart-at', date: '2026-10-12', time: '09:00' } });
    assert.equal(plans.length, 1);
    await planRoute({ from, to, mode: 'transit', transitTime: { kind: 'arrive-by', date: '2026-10-12', time: '10:00' } });
    assert.match(queries[0]!, /date:"2026-10-12",time:"09:00:00",arriveBy:false/);
    assert.match(queries[1]!, /time:"10:00:00",arriveBy:true/);
    assert.match(queries[0]!, /serviceDate route/); assert.match(queries[0]!, /trip \{ gtfsId tripHeadsign \}/);
    assert.match(queries[0]!, /stop \{ gtfsId name code platformCode \}/);
  } finally { global.fetch = original; }
});
