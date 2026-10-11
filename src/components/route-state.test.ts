import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoutePlan } from '../domain/types';
import { emptyRouteState, routeQueryKey, routeReducer, selectedRoute, visibleRouteState } from './route-state';

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

test('refresh follows stable itinerary identity and retains its original preview when removed', () => {
  let state = routeReducer(loaded(), { type: 'select', id: 'two' });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 2, plans: [plan('two', 2000), plan('one', 2000)] });
  assert.equal(state.selectedId, 'two');
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 3 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('one', 3000)] });
  assert.equal(state.selectedId, 'two');
  assert.equal(selectedRoute(state)?.id, 'two');
  assert.equal(selectedRoute(state)?.fetchedAt, 2000);
  assert.deepEqual(state.plans.map(plan => plan.id), ['one']);
  assert.equal(state.retainedSelection?.id, 'two');
  state = routeReducer(state, { type: 'select', id: 'unknown' });
  assert.equal(state.retainedSelection?.id, 'two');
  state = routeReducer(state, { type: 'select', id: 'one' });
  assert.equal(state.selectedId, 'one');
  assert.equal(state.retainedSelection, null);
  assert.equal(selectedRoute(state)?.fetchedAt, 3000);
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
  assert.equal(state.saved, true);
  assert.equal(state.selectedId, 'saved');
  assert.equal(state.retainedSelection, saved);
  state = routeReducer(state, { type: 'select', id: 'fresh' });
  assert.equal(state.saved, false);
  assert.equal(state.selectedId, 'fresh');
  assert.equal(saved.fetchedAt, 500);
  state = routeReducer(state, { type: 'restore', queryKey: 'A', request: 4, plan: saved });
  state = routeReducer(state, { type: 'reset' });
  assert.equal(state.saved, false);
  assert.deepEqual(state.plans, []);
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [plan('late')] }), state);
});

test('restored view identity survives refresh success before delayed deletion, then rejects late results after dismissal', () => {
  let state = routeReducer(emptyRouteState, { type: 'restore', queryKey: 'A', request: 10, plan: plan('saved', 500) });
  const restoredViewId = state.restoredViewId;
  assert.equal(restoredViewId, 10);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 11 });
  // Deletion is pending while this same-query refresh completes successfully.
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 11, plans: [plan('fresh', 900)] });
  assert.equal(state.saved, true);
  assert.equal(state.retainedSelection?.id, 'saved');
  assert.equal(state.restoredViewId, restoredViewId);
  // A successful removal can still identify and dismiss this restored view.
  state = routeReducer(state, { type: 'reset' });
  assert.equal(state.restoredViewId, null);
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 11, plans: [plan('late')] }), state);
  state = routeReducer(state, { type: 'restore', queryKey: 'A', request: 12, plan: plan('reopened', 600) });
  assert.equal(state.restoredViewId, 12);
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 11, plans: [plan('late')] }), state);
});

test('leaving a restored view before delayed deletion cannot dismiss an unrelated new route', () => {
  let state = routeReducer(emptyRouteState, { type: 'restore', queryKey: 'A', request: 1, plan: plan('saved') });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  assert.equal(visibleRouteState(state, 'B').restoredViewId, null);
  state = routeReducer(state, { type: 'start', queryKey: 'B', request: 3 });
  assert.equal(state.restoredViewId, null);
  state = routeReducer(state, { type: 'success', queryKey: 'B', request: 3, plans: [plan('unrelated')] });
  assert.equal(state.restoredViewId, null);
  assert.equal(state.selectedId, 'unrelated');
  assert.equal(routeReducer(state, { type: 'success', queryKey: 'A', request: 2, plans: [plan('obsolete')] }), state);
  state = routeReducer(state, { type: 'reset' });
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 4 });
  assert.equal(state.restoredViewId, null, 'a new ordinary route to the same endpoints is not a restored view');
});


test('retained route survives further missing results and errors, then reappears with the same stable identity', () => {
  let state = routeReducer(loaded(), { type: 'select', id: 'two' });
  const original = selectedRoute(state);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 2 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 2, plans: [plan('three', 2000)] });
  assert.equal(selectedRoute(state), original);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 3 });
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 3, plans: [] });
  assert.equal(selectedRoute(state), original);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 4 });
  state = routeReducer(state, { type: 'failure', queryKey: 'A', request: 4, error: 'Offline' });
  assert.equal(selectedRoute(state), original);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 5 });
  const reappeared = plan('two', 5000);
  state = routeReducer(state, { type: 'success', queryKey: 'A', request: 5, plans: [plan('one', 5000), reappeared] });
  assert.equal(selectedRoute(state), reappeared);
  assert.equal(state.retainedSelection, null);
  assert.equal(original?.fetchedAt, 1000);
});

test('activity suspension settles loading without hiding matching data or accepting old completions', () => {
  let state = routeReducer(loaded(), { type: 'start', queryKey: 'A', request: 2 });
  const original = selectedRoute(state);
  state = routeReducer(state, { type: 'settled', queryKey: 'A', request: 2 });
  assert.equal(state.loading, false);
  assert.equal(selectedRoute(visibleRouteState(state, 'A')), original);
  state = routeReducer(state, { type: 'start', queryKey: 'A', request: 3 });
  assert.equal(routeReducer(state, { type: 'settled', queryKey: 'A', request: 2 }), state);
});
