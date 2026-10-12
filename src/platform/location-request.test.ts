import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationLookup, LocationError, waitForLocation, type LocationSample } from './location-request';

const sample = (): LocationSample => ({ timestamp: Date.now() - 1, coords: { longitude: 7, latitude: 45, accuracy: 25 } });

test('authorized startup and manual locate share a foreground fix without a permission prompt', async () => {
  const permissionRequests: boolean[] = [];
  let acquisitions = 0;
  let complete!: (value: { coordinate: [number, number]; accuracy: number }) => void;
  const lookup = createLocationLookup(async request => { permissionRequests.push(request); return true; }, () => {
    acquisitions++;
    return new Promise(resolve => { complete = resolve; });
  });
  const startup = lookup.getAuthorizedLocation();
  const manual = lookup.getCurrentLocation();
  await Promise.resolve();
  assert.equal(acquisitions, 1);
  assert.deepEqual(permissionRequests, [false, true]);
  complete({ coordinate: [7, 45], accuracy: 25 });
  assert.deepEqual(await startup, await manual);
});

test('quiet launch without authorization does not acquire or block a later explicit request', async () => {
  const requested: boolean[] = [];
  let acquisitions = 0;
  const lookup = createLocationLookup(async request => { requested.push(request); return request; }, async () => {
    acquisitions++; return { coordinate: [7, 45], accuracy: null };
  });
  assert.equal(await lookup.getAuthorizedLocation(), null);
  assert.equal(acquisitions, 0);
  assert.deepEqual((await lookup.getCurrentLocation()).coordinate, [7, 45]);
  assert.deepEqual(requested, [false, true]);
});

function sourceFixture() {
  let listener: ((sample: LocationSample) => void) | undefined;
  let inactive: (() => void) | undefined;
  let removals = 0;
  let activityRemovals = 0;
  const source = {
    addListener(callback: (sample: LocationSample) => void) { listener = callback; },
    removeListener() { listener = undefined; removals++; },
    getCurrentPosition: async () => undefined,
  };
  return { source, emit: (value: LocationSample) => listener?.(value), deactivate: () => inactive?.(),
    onInactive(callback: () => void) { inactive = callback; return () => { inactive = undefined; activityRemovals++; }; },
    counts: () => [removals, activityRemovals],
  };
}

test('a missing cached fix keeps acquisition alive; stale, future and invalid fixes cannot settle it', async () => {
  const fixture = sourceFixture();
  let settled = false;
  const pending = waitForLocation(fixture.source, fixture.onInactive).then(value => { settled = true; return value; });
  fixture.emit({ ...sample(), timestamp: Date.now() - 120_000 });
  fixture.emit({ ...sample(), timestamp: Date.now() + 120_000 });
  fixture.emit({ ...sample(), coords: { longitude: 200, latitude: 45 } });
  await Promise.resolve();
  assert.equal(settled, false);
  fixture.emit(sample());
  assert.deepEqual(await pending, { coordinate: [7, 45], accuracy: 25 });
  assert.deepEqual(fixture.counts(), [1, 1]);
});

test('backgrounding cancels the request and releases position and activity listeners', async () => {
  const fixture = sourceFixture();
  const pending = waitForLocation(fixture.source, fixture.onInactive);
  fixture.deactivate();
  await assert.rejects(pending, (error: unknown) => error instanceof LocationError && error.code === 'unavailable');
  assert.deepEqual(fixture.counts(), [1, 1]);
});

test('no fix gives an actionable timeout and a subsequent request can succeed', async () => {
  const fixture = sourceFixture();
  await assert.rejects(waitForLocation(fixture.source, fixture.onInactive, 1), (error: unknown) => error instanceof LocationError && error.code === 'timeout');
  assert.deepEqual(fixture.counts(), [1, 1]);
  const next = waitForLocation(fixture.source, fixture.onInactive);
  fixture.emit(sample());
  assert.deepEqual((await next).coordinate, [7, 45]);
});

test('a synchronous cached fix settles and releases acquisition without restarting it', async () => {
  const fixture = sourceFixture();
  let cacheReads = 0;
  fixture.source.addListener = listener => listener(sample());
  fixture.source.getCurrentPosition = async () => { cacheReads++; return undefined; };
  assert.deepEqual((await waitForLocation(fixture.source, fixture.onInactive)).coordinate, [7, 45]);
  assert.equal(cacheReads, 0);
  assert.deepEqual(fixture.counts(), [1, 1]);
});

test('a request that is already inactive never starts the position source', async () => {
  const fixture = sourceFixture();
  let starts = 0;
  let activityRemovals = 0;
  fixture.source.addListener = () => { starts++; };
  await assert.rejects(waitForLocation(fixture.source, listener => {
    listener();
    return () => { activityRemovals++; };
  }), (error: unknown) => error instanceof LocationError && error.code === 'unavailable');
  assert.equal(starts, 0);
  assert.equal(activityRemovals, 1);
});
