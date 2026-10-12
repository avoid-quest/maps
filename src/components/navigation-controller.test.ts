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

test('successful native reads and events clear the recovered read error without hiding command failures', async () => {
  let readable = false;
  const { controller, emit } = fixture({
    getSnapshot: async () => { if (!readable) throw new Error('bridge unavailable'); return idleNavigation; },
    prepareStart: async () => { throw new Error('location-permission'); },
  });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().ready, false);
  assert.match(controller.getSnapshot().error!, /Stato della navigazione/);
  readable = true;
  await controller.refresh();
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().error, null);
  await controller.start(options);
  const denied = controller.getSnapshot().error;
  assert.match(denied!, /posizione precisa/);
  await controller.refresh();
  assert.equal(controller.getSnapshot().error, denied);
  readable = false;
  await controller.refresh();
  emit(snapshot(10));
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().error, null);
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
  assert.deepEqual(calls, ['read']);
  assert.equal(controller.getSnapshot().snapshot.status, 'idle');
  assert.equal(controller.getSnapshot().busy, null);
});

test('cancelling permission for a new Start does not send Stop for the previous stopped session', async () => {
  const permission = deferred<void>();
  const { controller, calls } = fixture({ getSnapshot: async () => snapshot(1, 'stopped'), prepareStart: () => permission.promise });
  await Promise.resolve();
  const start = controller.start(options);
  await controller.stop();
  permission.resolve();
  await start;
  assert.deepEqual(calls, []);
  assert.equal(controller.getSnapshot().snapshot.status, 'stopped');
});

test('a delayed Stop from an obsolete controller cannot stop a replacement native session', async () => {
  const deliver = deferred<void>();
  let native = snapshot(10);
  const targets: (string | null)[] = [];
  const { controller, disconnect } = fixture({
    getSnapshot: async () => native,
    stopNavigation: async id => {
      targets.push(id);
      await deliver.promise;
      if (id === null || id === native.sessionId) native = { ...native, revision: 12, status: 'stopped' };
      return native;
    },
  });
  await Promise.resolve();
  const stopping = controller.stop();
  disconnect();
  native = { ...snapshot(11), sessionId: 'replacement' };
  deliver.resolve();
  assert.equal(await stopping, false);
  assert.deepEqual(targets, ['session']);
  assert.equal(native.status, 'navigating');
});

test('Stop targets a new session event while Start is pending, otherwise cancels only a submitted Start', async () => {
  for (const reported of [false, true]) {
    const started = deferred<NavigationSnapshot>();
    const targets: (string | null)[] = [];
    const { controller, emit } = fixture({
      getSnapshot: async () => snapshot(1, 'stopped'),
      startNavigation: () => started.promise,
      stopNavigation: async id => { targets.push(id); return snapshot(4, 'stopped'); },
    });
    await Promise.resolve();
    const start = controller.start(options);
    await Promise.resolve();
    if (reported) emit({ ...snapshot(3, 'waiting-for-fix'), sessionId: 'new-start' });
    await controller.stop();
    started.resolve({ ...snapshot(2, 'waiting-for-fix'), sessionId: 'new-start' });
    await start;
    assert.deepEqual(targets, [reported ? 'new-start' : null]);
    assert.equal(controller.getSnapshot().snapshot.status, 'stopped');
  }
});

test('Back confirms active guidance and a late confirmation cannot stop a replacement session', async () => {
  const targets: (string | null)[] = [];
  const { controller, emit } = fixture({ stopNavigation: async id => { targets.push(id); return snapshot(20, 'stopped'); } });
  emit(snapshot(10));
  let confirmStop: (() => void) | undefined;
  assert.equal(controller.back(stop => { confirmStop = stop; }), true);
  assert.deepEqual(targets, []); // Continuing or dismissing the dialog leaves guidance running.
  emit({ ...snapshot(11), sessionId: 'replacement' });
  confirmStop!();
  await Promise.resolve();
  assert.deepEqual(targets, []);
  controller.back(stop => { confirmStop = stop; });
  confirmStop!();
  await Promise.resolve();
  assert.deepEqual(targets, ['replacement']);
});

test('Back cancels pending permission and closes terminal states without a guidance confirmation', async () => {
  const permission = deferred<void>();
  const pending = fixture({ prepareStart: () => permission.promise });
  await Promise.resolve();
  assert.equal(pending.controller.back(() => assert.fail('Idle has no confirmation')), false);
  const start = pending.controller.start(options);
  assert.equal(pending.controller.back(() => assert.fail('Pending Start cancels')), true);
  permission.resolve();
  await start;
  assert.deepEqual(pending.calls, ['read']);
  for (const status of ['arrived', 'error', 'interrupted'] as const) {
    const { controller, emit, calls } = fixture();
    emit(snapshot(1, status));
    assert.equal(controller.back(() => assert.fail('Terminal Back closes')), true);
    await Promise.resolve();
    assert.ok(calls.includes('stop'));
  }
});

test('a dismissed controller or repeated Back confirmation cannot submit another Stop', async () => {
  const { controller, emit, disconnect, calls } = fixture();
  emit(snapshot(10));
  let confirmStop: (() => void) | undefined;
  controller.back(stop => { confirmStop = stop; });
  disconnect();
  confirmStop!();
  await Promise.resolve();
  assert.equal(calls.includes('stop'), false);
  controller.back(stop => { confirmStop = stop; });
  confirmStop!();
  confirmStop!();
  await Promise.resolve();
  assert.equal(calls.filter(call => call === 'stop').length, 1);
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
