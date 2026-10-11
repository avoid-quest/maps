import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoutePlan } from '../domain/types';
import { emptyRouteState, routeQueryKey, routeReducer, visibleRouteState } from './route-state';

function plan(id: string, fetchedAt = 1000): RoutePlan {
  return {
    id, fetchedAt, mode: 'transit', durationSeconds: 600, distanceMeters: 1200,
    walkingDurationSeconds: 60, walkingDistanceMeters: 100, waitingDurationSeconds: 30,
    transferCount: 0, geometry: [], legs: [], source: 'Test', warnings: [],
  };
}
function loaded() {
  return routeReducer(routeReducer(emptyRouteState, { type: 'start', queryKey: 'A', request: 1 }),
    { type: 'success', queryKey: 'A', request: 1, plans: [plan('one'), plan('two')] });
}

test('failed refresh retains selected itinerary and its original retrieval timestamp', () => {
  let state = routeReducer(loaded(), { type: 'select', id: 'two' });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  assert.equal(state.selectedId, 'two');
  assert.equal(state.plans.length, 2);
  state = routeReducer(state, { type: 'failure', queryKey: 'A', request: 2, error: 'Offline' });
  assert.equal(state.loading, false);
  assert.equal(state.error, 'Offline');
  assert.equal(state.selectedId, 'two');
  assert.equal(state.plans[1]!.fetchedAt, 1000);
});

test('refresh follows stable itinerary identity when alternatives reorder, then falls back if removed', () => {
  let state = routeReducer(loaded(), { type: 'select', id: 'two' });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 2, plans: [plan('two', 2000), plan('one', 2000)] });
  assert.equal(state.selectedId, 'two');
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 3 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('one', 3000)] });
  assert.equal(state.selectedId, 'one');
});

test('endpoint or submitted-time change hides previous data before the request effect runs', () => {
  let state = loaded();
  assert.deepEqual(visibleRouteState(state, 'B').plans, []);
  state = routeReducer(state, { type: 'start', queryKey: 'B', request: 2 });
  state = routeReducer(state, { type: 'failure', queryKey: 'B', request: 2, error: 'Offline' });
  assert.deepEqual(state.plans, []);
  assert.equal(state.selectedId, null);
});

test('late completions cannot replace or fail a newer request, including refresh of the same query', () => {
  let state = routeReducer(loaded(), { type: 'start', queryKey: 'A', request: 3 });
  assert.equal(routeReducer(state, { type: 'failure', queryKey: 'A', request: 2, error: 'Late failure' }), state);
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 2, plans: [plan('obsolete')] }), state);
  state = routeReducer(state, { type: 'start', queryKey: 'B', request: 4 });
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('obsolete')] }), state);
  state = routeReducer(state, { type: 'reset' });
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'B', request: 4, plans: [plan('closed')] }), state);
});

test('request identity includes endpoints, mode and submitted civil time, while ignoring transit time on road modes', () => {
  const base = { from: { latitude: 45, longitude: 7 }, to: { latitude: 45.1, longitude: 7.1 }, mode: 'transit' as const };
  const depart = { kind: 'depart-at' as const, date: '2026-10-12', time: '08:00' };
  assert.equal(routeQueryKey(base), routeQueryKey({ ...base, transitTime: { kind: 'now' } }));
  assert.notEqual(routeQueryKey(base), routeQueryKey({ ...base, to: { ...base.to, longitude: 7.2 } }));
  assert.notEqual(routeQueryKey(base), routeQueryKey({ ...base, from: { ...base.from, latitude: 45.2 } }));
  assert.notEqual(routeQueryKey(base), routeQueryKey({ ...base, mode: 'walk' }));
  assert.notEqual(routeQueryKey({ ...base, transitTime: depart }), routeQueryKey({ ...base, transitTime: { ...depart, kind: 'arrive-by' } }));
  assert.notEqual(routeQueryKey({ ...base, transitTime: depart }), routeQueryKey({ ...base, transitTime: { ...depart, time: '09:00' } }));
  assert.equal(routeQueryKey({ ...base, mode: 'walk' }), routeQueryKey({ ...base, mode: 'walk', transitTime: depart }));
});

test('restore exposes only the exact saved alternative without loading and invalidates older responses', () => {
  const saved = plan('chosen-alternative', 500);
  const pending = routeReducer(loaded(), { type: 'start', queryKey: 'A', request: 3 });
  const restored = routeReducer(pending, { type: 'restore', queryKey: 'A', request: 4, plan: saved });
  assert.deepEqual(restored.plans, [saved]);
  assert.equal(restored.plans[0], saved);
  assert.equal(restored.selectedId, saved.id);
  assert.equal(restored.loading, false);
  assert.equal(restored.saved, true);
  assert.equal(routeReducer(restored, { type: 'success', queryKey: 'A', request: 3, plans: [plan('obsolete')] }), restored);
  assert.equal(routeReducer(restored, { type: 'failure', queryKey: 'A', request: 3, error: 'Old error' }), restored);
  assert.equal(visibleRouteState(restored, 'B').saved, false);
  assert.deepEqual(visibleRouteState(restored, 'B').plans, []);
});

test('failed explicit refresh keeps a restored copy; successful refresh changes only the displayed state', () => {
  const saved = plan('saved', 500);
  let state = routeReducer(emptyRouteState, { type: 'restore', queryKey: 'A', request: 1, plan: saved });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  state = routeReducer(state, { type: 'failure', queryKey: 'A', request: 2, error: 'Offline' });
  assert.equal(state.saved, true);
  assert.equal(state.plans[0], saved);
  assert.equal(state.plans[0]!.fetchedAt, 500);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 3 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('fresh', 900)] });
  assert.equal(state.saved, false);
  assert.equal(state.selectedId, 'fresh');
  assert.equal(saved.fetchedAt, 500);
  state = routeReducer(state, { type: 'restore', queryKey: 'A', request: 4, plan: saved });
  state = routeReducer(state, { type: 'reset' });
  assert.equal(state.saved, false);
  assert.deepEqual(state.plans, []);
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('late')] }), state);
});
