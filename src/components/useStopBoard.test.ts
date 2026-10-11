import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyResource, retainedResourceReducer, visibleResource } from './useStopBoard';

test('arrival and alert failures independently retain their original snapshots and errors', () => {
  const board = { fetchedAt: 1000, departures: ['arrival'] };
  const alerts = { fetchedAt: 2000, alerts: ['alert'] };
  let arrivals = retainedResourceReducer(emptyResource<typeof board>('A'), { type: 'success', identity: 'A', data: board });
  let notices = retainedResourceReducer(emptyResource<typeof alerts>('A'), { type: 'success', identity: 'A', data: alerts });
  arrivals = retainedResourceReducer(arrivals, { type: 'loading', identity: 'A', loading: true });
  notices = retainedResourceReducer(notices, { type: 'loading', identity: 'A', loading: true });
  assert.equal(arrivals.data, board);
  assert.equal(notices.data, alerts);
  arrivals = retainedResourceReducer(arrivals, { type: 'failure', identity: 'A', error: 'Arrivals unavailable' });
  const freshAlerts = { fetchedAt: 3000, alerts: ['new alert'] };
  notices = retainedResourceReducer(notices, { type: 'success', identity: 'A', data: freshAlerts });
  assert.equal(arrivals.data, board);
  assert.equal(arrivals.data?.fetchedAt, 1000);
  assert.equal(arrivals.error, 'Arrivals unavailable');
  assert.equal(notices.data, freshAlerts);
  assert.equal(notices.error, '');
  arrivals = retainedResourceReducer(arrivals, { type: 'loading', identity: 'A', loading: true });
  assert.equal(arrivals.error, 'Arrivals unavailable', 'retrying does not erase the prior failure');
  notices = retainedResourceReducer(notices, { type: 'failure', identity: 'A', error: 'Alerts unavailable' });
  assert.equal(notices.data, freshAlerts);
  assert.equal(notices.error, 'Alerts unavailable');
  assert.equal(arrivals.data, board);
});

test('stop identity hides old data immediately and rejects mismatched resource completions', () => {
  const board = { fetchedAt: 1000 };
  let state = retainedResourceReducer(emptyResource<typeof board>('A'), { type: 'success', identity: 'A', data: board });
  assert.equal(visibleResource(state, 'A').data, board);
  assert.equal(visibleResource(state, 'B').data, null);
  state = retainedResourceReducer(state, { type: 'identity', identity: 'B' });
  assert.equal(state.data, null);
  for (const action of [
    { type: 'success', identity: 'A', data: board },
    { type: 'failure', identity: 'A', error: 'Late' },
    { type: 'loading', identity: 'A', loading: false },
  ] as const) assert.equal(retainedResourceReducer(state, action), state);
});

test('same-view activity suspension preserves source age and failure state', () => {
  const data = { fetchedAt: 1000 };
  let state = retainedResourceReducer(emptyResource<typeof data>('A'), { type: 'success', identity: 'A', data });
  state = retainedResourceReducer(state, { type: 'failure', identity: 'A', error: 'Offline' });
  state = retainedResourceReducer(state, { type: 'loading', identity: 'A', loading: false });
  assert.equal(state.data, data);
  assert.equal(state.error, 'Offline');
  assert.equal(state.data?.fetchedAt, 1000);
  assert.equal(retainedResourceReducer(state, { type: 'identity', identity: 'A' }), state);
});
