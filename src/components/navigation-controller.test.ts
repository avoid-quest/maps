import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationController } from './navigation-controller';
import { idleNavigation, navigationLocationForReplan, type NavigationPlatform, type NavigationSnapshot } from '../domain/navigation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const options = { destination: { latitude: 45, longitude: 7 }, mode: 'walk' as const };
const snapshot = (revision: number, status: NavigationSnapshot['status'] = 'navigating'): NavigationSnapshot => ({
  ...idleNavigation, revision, status, sessionId: 'session', mode: 'walk', canRetry: status === 'interrupted',
});
function fixture(overrides: Partial<NavigationPlatform> = {}, record?: Parameters<typeof createNavigationController>[1]) {
  const calls: string[] = [];
  let listener: (value: NavigationSnapshot) => void = () => {};
  const platform: NavigationPlatform = {
    supported: true,
    prepareStart: async () => { calls.push('permission'); },
    startNavigation: async () => { calls.push('start'); return snapshot(2, 'waiting-for-fix'); },
    startTransitNavigation: async () => { calls.push('transit-start'); return { ...snapshot(2, 'waiting-for-fix'), mode: 'transit' }; },
    confirmTransitStep: async (_sessionId, action) => { calls.push(action); return snapshot(3); },
    stopNavigation: async () => { calls.push('stop'); return snapshot(4, 'stopped'); },
    retryNavigation: async () => { calls.push('retry'); return snapshot(3, 'waiting-for-fix'); },
    setMuted: async () => snapshot(3),
    getSnapshot: async () => { calls.push('read'); return idleNavigation; },
    subscribe: callback => { listener = callback; return () => { calls.push('unsubscribe'); }; },
    ...overrides,
  };
  const controller = createNavigationController(platform, record);
  const disconnect = controller.connect();
  return { controller, calls, disconnect, emit: (value: NavigationSnapshot) => listener(value) };
}

test('reattaching restores an interrupted session without permission, positioning or routing commands', async () => {
  const { controller, calls } = fixture({ getSnapshot: async () => snapshot(1, 'interrupted') });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().snapshot.status, 'interrupted');
  assert.deepEqual(calls, []);
  await controller.retry();
  assert.deepEqual(calls, ['permission', 'retry']);
});

test('a delayed initial read cannot replace a more recent native event', async () => {
  const read = deferred<NavigationSnapshot>();
  const { controller, emit } = fixture({ getSnapshot: () => read.promise });
  emit(snapshot(10));
  read.resolve(snapshot(1, 'interrupted'));
  await Promise.resolve();
  assert.equal(controller.getSnapshot().snapshot.revision, 10);
});

test('Start waits for known native session state and a failed read never assumes the service is idle', async () => {
  const read = deferred<NavigationSnapshot>();
  const { controller, calls } = fixture({ getSnapshot: () => read.promise });
  await controller.start(options);
  assert.deepEqual(calls, []);
  read.reject(new Error('unavailable'));
  await Promise.resolve();
  await controller.start(options);
  assert.deepEqual(calls, []);
  assert.equal(controller.getSnapshot().ready, false);
});

test('Stop while permission is pending prevents the late Start and remains idempotent', async () => {
  const permission = deferred<void>();
  const { controller, calls } = fixture({ prepareStart: () => permission.promise });
  await Promise.resolve();
  const start = controller.start(options);
  await controller.stop();
  permission.resolve();
  await start;
  await controller.stop();
  assert.deepEqual(calls, ['read', 'stop', 'stop']);
  assert.equal(controller.getSnapshot().snapshot.status, 'stopped');
  assert.equal(controller.getSnapshot().busy, null);
});

test('new native events beat delayed command results and duplicate Start is coalesced', async () => {
  const started = deferred<NavigationSnapshot>();
  let starts = 0;
  const { controller, emit } = fixture({ startNavigation: () => { starts += 1; return started.promise; } });
  await Promise.resolve();
  const first = controller.start(options);
  await controller.start(options);
  emit(snapshot(8));
  started.resolve(snapshot(2, 'waiting-for-fix'));
  await first;
  assert.equal(starts, 1);
  assert.equal(controller.getSnapshot().snapshot.status, 'navigating');
  assert.equal(controller.getSnapshot().snapshot.revision, 8);
});

test('Stop fences late errors and does not expose native raw errors', async () => {
  const started = deferred<NavigationSnapshot>();
  const { controller } = fixture({ startNavigation: () => started.promise });
  await Promise.resolve();
  const start = controller.start(options);
  await Promise.resolve();
  await controller.stop();
  started.reject(new Error('secret coordinates in provider URL'));
  await start;
  assert.equal(controller.getSnapshot().error, null);
  const failed = fixture({ prepareStart: async () => { throw new Error('secret coordinates in provider URL'); } });
  await Promise.resolve();
  await failed.controller.start(options);
  assert.equal(failed.controller.getSnapshot().error?.includes('secret'), false);
});

test('location events retain route identity; rerouting replaces geometry and disconnect rejects late events', () => {
  const { controller, emit, disconnect } = fixture();
  const route = { geometry: [options.destination, { latitude: 45.1, longitude: 7.1 }], source: 'FOSSGIS', fetchedAt: 100 };
  emit({ ...snapshot(5), routeRevision: 1, route });
  emit({ ...snapshot(6), routeRevision: 1 });
  assert.equal(controller.getSnapshot().snapshot.route, route);
  const replacement = { ...route, fetchedAt: 200 };
  emit({ ...snapshot(7), routeRevision: 2, route: replacement });
  assert.equal(controller.getSnapshot().snapshot.route, replacement);
  disconnect();
  emit(snapshot(8, 'stopped'));
  assert.equal(controller.getSnapshot().snapshot.revision, 7);
});

test('route deltas clear on explicit null or a new session and late full reads only fill matching missing geometry', async () => {
  const read = deferred<NavigationSnapshot>();
  const { controller, emit } = fixture({ getSnapshot: () => read.promise });
  const route = { geometry: [options.destination], source: 'FOSSGIS', fetchedAt: 100 };
  emit({ ...snapshot(5), routeRevision: 1 });
  read.resolve({ ...snapshot(4, 'waiting-for-fix'), routeRevision: 1, route });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().snapshot.route, route);
  assert.equal(controller.getSnapshot().snapshot.status, 'navigating');
  emit({ ...snapshot(6), routeRevision: 1, route: null });
  assert.equal(controller.getSnapshot().snapshot.route, null);
  emit({ ...snapshot(7), routeRevision: 2, route });
  emit({ ...snapshot(8), sessionId: 'new-session', routeRevision: 2 });
  assert.equal(controller.getSnapshot().snapshot.route, undefined);
});

test('diagnostics retain only session transitions and fixed failures across position ticks', async () => {
  const recorded: string[] = [];
  const { controller, emit } = fixture({}, state => recorded.push(state));
  await Promise.resolve();
  await controller.start(options);
  for (let revision = 3; revision < 30; revision++) emit(snapshot(revision));
  emit({ ...snapshot(30, 'location-degraded'), problem: 'location-stale' });
  emit({ ...snapshot(31, 'error'), problem: 'engine-unavailable' });
  emit({ ...snapshot(32, 'error'), problem: 'engine-unavailable' });
  assert.deepEqual(recorded, ['start-requested', 'active', 'degraded', 'engine-unavailable']);
});

test('explicit transit confirmations remain usable without GPS, and Stop rejects late confirmation responses', async () => {
  const confirmation = deferred<NavigationSnapshot>();
  const { controller, emit, calls } = fixture({ confirmTransitStep: async (_id, action) => { calls.push(action); return confirmation.promise; } });
  emit({ ...snapshot(2, 'location-degraded'), mode: 'transit', problem: 'location-stale' });
  const confirming = controller.confirmTransit('alight');
  await controller.stop();
  confirmation.resolve({ ...snapshot(3), mode: 'transit' });
  await confirming;
  assert.ok(calls.includes('alight'));
  assert.equal(controller.getSnapshot().snapshot.status, 'stopped');
});

test('mounted subscribers receive lost and recovered confidence while the transit admission error stays latched', async () => {
  const { controller, emit, calls } = fixture();
  await Promise.resolve();
  const now = Date.UTC(2026, 9, 12, 12);
  const rejected: NavigationSnapshot = { ...snapshot(10, 'error'), mode: 'transit', problem: 'transit-replan-needed',
    locationUsable: true, location: { ...options.destination, accuracyMeters: 8, timestamp: now } };
  const origins: ReturnType<typeof navigationLocationForReplan>[] = [];
  const problems: NavigationSnapshot['problem'][] = [];
  controller.subscribe(() => {
    const current = controller.getSnapshot().snapshot;
    origins.push(navigationLocationForReplan(current, now));
    problems.push(current.problem);
  });
  emit(rejected);
  emit({ ...rejected, revision: 11, locationUsable: false });
  emit({ ...rejected, revision: 12, locationUsable: true });
  assert.deepEqual(origins, [options.destination, null, options.destination]);
  assert.deepEqual(problems, Array(3).fill('transit-replan-needed'));
  assert.deepEqual(calls, ['read']); // Recovery events never retry admission or start a route request.
});
