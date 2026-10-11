import test from 'node:test';
import assert from 'node:assert/strict';
import { createActiveRefresh, REFRESH_INTERVALS, type RefreshResult } from './active-refresh';
import { FakeClock, deferred, flush } from './active-refresh.test-support';

function harness(intervalMs: number | null = REFRESH_INTERVALS.arrivals, clock = new FakeClock()) {
  const requests: { at: number; signal: AbortSignal; result: ReturnType<typeof deferred<RefreshResult<string>>> }[] = [];
  const successes: string[] = []; const errors: unknown[] = []; const loading: boolean[] = [];
  const control = createActiveRefresh({ intervalMs, timing: clock,
    load: signal => { const result = deferred<RefreshResult<string>>(); requests.push({ at: clock.mono, signal, result }); return result.promise; },
    onSuccess: value => successes.push(value), onError: error => errors.push(error), onLoadingChange: value => loading.push(value),
  });
  return {
    clock, control, requests, successes, errors, loading,
    async success(value = 'current', fetchedAt = clock.wall) { requests.at(-1)!.result.resolve({ value, fetchedAt }); await flush(); },
    async fail(error: unknown = { kind: 'network' }) { requests.at(-1)!.result.reject(error); await flush(); },
    open() { control.setActive(true); control.refresh(); },
  };
}

test('saved restore stays unarmed through visible, privacy and background transitions until explicit refresh', async () => {
  const h = harness();
  for (let index = 0; index < 3; index++) {
    h.control.setActive(true); h.clock.jump(86_400_000); h.control.setActive(false);
  }
  assert.equal(h.requests.length, 0); assert.equal(h.clock.timerCount, 0);
  h.control.refresh(); assert.equal(h.requests.length, 0, 'Explicit hidden intent does not load in the background');
  h.control.setActive(true); assert.equal(h.requests.length, 1);
  await h.success(); assert.equal(h.clock.nextDue, h.clock.mono + 60_000);
});

test('arrivals, alerts and transit use independent 60/300/120 second deadlines', async () => {
  const clock = new FakeClock();
  const resources = Object.values(REFRESH_INTERVALS).map(interval => harness(interval, clock));
  resources.forEach(h => h.open()); await Promise.all(resources.map(h => h.success()));
  clock.advance(59_999); assert.deepEqual(resources.map(h => h.requests.length), [1, 1, 1]);
  clock.advance(1); assert.deepEqual(resources.map(h => h.requests.length), [2, 1, 1]);
  await resources[0]!.success(); clock.advance(60_000);
  assert.deepEqual(resources.map(h => h.requests.length), [3, 1, 2]);
  await resources[0]!.success(); await resources[2]!.success();
  clock.jump(180_000); assert.deepEqual(resources.map(h => h.requests.length), [4, 2, 3]);
});

test('manual refresh runs promptly before the next successful poll; pending manual requests coalesce', async () => {
  const h = harness(); h.open();
  h.control.refresh(); h.control.refresh(); h.clock.jump(1_000_000);
  assert.equal(h.requests.length, 1); assert.equal(h.clock.timerCount, 0);
  await h.success(); assert.equal(h.clock.nextDue, h.clock.mono + 60_000);
  h.control.refresh(); assert.equal(h.requests.length, 2);
  h.control.refresh(); await h.success();
  assert.equal(h.requests.length, 2, 'A tap during the request does not queue another load');
  assert.deepEqual(h.loading, [true, false, true, false]);
});

test('hiding aborts synchronously, invalidates late success and retains one physical request until settlement', async () => {
  const h = harness(); h.open(); h.control.setActive(false);
  assert.equal(h.requests[0]!.signal.aborted, true); assert.deepEqual(h.loading, [true, false]);
  h.clock.jump(600_000); h.control.setActive(true);
  assert.equal(h.requests.length, 1, 'An abort-ignoring load cannot overlap a replacement');
  await h.success('obsolete');
  assert.deepEqual(h.successes, []); assert.deepEqual(h.errors, []);
  assert.equal(h.requests.length, 2, 'Resume starts only one overdue request after the aborted load settles');
  await h.success('visible'); assert.deepEqual(h.successes, ['visible']);
});

test('cancellation does not increase backoff and an early return preserves the interrupted request deadline', async () => {
  const h = harness(); h.open(); h.clock.advance(5_000); h.control.setActive(false);
  await h.fail({ kind: 'rate-limit' });
  assert.deepEqual(h.errors, []);
  h.clock.advance(5_000); h.control.setActive(true);
  assert.equal(h.requests.length, 1); assert.equal(h.clock.nextDue, 60_000);
  h.clock.advance(50_000); assert.equal(h.requests.length, 2);
  await h.fail(); assert.equal(h.clock.nextDue, 120_000, 'First real failure still uses the base retry');
});

test('a long hidden interval causes one overdue request per resource without catch-up bursts', async () => {
  const clock = new FakeClock(); const board = harness(60_000, clock); const alerts = harness(300_000, clock);
  board.open(); alerts.open(); await board.success(); await alerts.success();
  board.control.setActive(false); alerts.control.setActive(false);
  assert.equal(clock.timerCount, 0); clock.jump(3_600_000);
  board.control.setActive(true); alerts.control.setActive(true);
  assert.equal(board.requests.length, 2); assert.equal(alerts.requests.length, 2);
  await board.success(); await alerts.success(); await flush();
  assert.equal(board.requests.length, 2); assert.equal(alerts.requests.length, 2);
  assert.equal(clock.nextDue, clock.mono + 60_000);
});

test('429 starts cooldown at failure completion and manual/visibility changes cannot bypass it or show false loading', async () => {
  const h = harness(); h.open(); h.clock.advance(7_000); await h.fail({ kind: 'rate-limit' });
  h.control.refresh(); h.control.refresh();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.loading, [true, false]);
  h.control.setActive(false); h.clock.advance(20_000); h.control.setActive(true); h.control.refresh();
  assert.equal(h.clock.nextDue, 67_000);
  h.clock.earlyWake(5); assert.equal(h.requests.length, 1); assert.equal(h.clock.nextDue, 67_000);
  h.clock.advance(5); assert.equal(h.requests.length, 2); assert.equal(h.requests[1]!.at, 67_000);
  const alerts = harness(300_000); alerts.open(); await alerts.fail({ kind: 'rate-limit' });
  alerts.control.refresh(); assert.equal(alerts.clock.nextDue, 300_000, 'Resource backoff may exceed provider cooldown');
});

test('ordinary failures back off 1x/2x/4x to fifteen minutes and success resets the sequence', async () => {
  const h = harness(); h.open();
  for (const delay of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
    await h.fail(); h.control.refresh();
    assert.equal(h.clock.nextDue - h.clock.mono, delay);
    h.clock.advance(delay);
  }
  await h.success(); h.control.refresh(); await h.fail();
  assert.equal(h.clock.nextDue - h.clock.mono, 60_000);
});

test('wall-clock jumps cannot change waiting poll or cooldown deadlines', async () => {
  const h = harness(); h.open(); await h.success();
  h.clock.shiftWall(365 * 86_400_000); h.clock.advance(59_999); assert.equal(h.requests.length, 1);
  h.clock.shiftWall(-2 * 365 * 86_400_000); h.clock.advance(1); assert.equal(h.requests.length, 2);
  await h.fail({ kind: 'rate-limit' }); const due = h.clock.nextDue;
  h.clock.shiftWall(3 * 365 * 86_400_000); h.control.refresh();
  assert.equal(h.clock.nextDue, due); assert.equal(h.requests.length, 2);
});

test('early manual cache hits keep the original alert deadline, then overdue cache hits wait a full interval', async () => {
  const h = harness(REFRESH_INTERVALS.alerts);
  const fetchedAt = h.clock.wall;
  h.open(); await h.success('initial', fetchedAt);
  assert.equal(h.clock.nextDue, 300_000);

  for (const refreshAt of [60_000, 299_000]) {
    h.clock.advance(refreshAt - h.clock.mono);
    h.control.refresh(); await h.success('same cached alerts', fetchedAt);
    assert.equal(h.clock.nextDue, 300_000, 'A manual cache hit cannot postpone retrieval expiry');
  }

  assert.equal(h.requests.length, 3);
  h.clock.advance(999); assert.equal(h.requests.length, 3);
  h.clock.advance(1); assert.equal(h.requests.length, 4);
  await h.success('unchanged at expiry', fetchedAt);
  assert.equal(h.clock.nextDue, 600_000, 'An unchanged expired result cannot spin');
  h.clock.advance(300_000); await h.success('unchanged overdue', fetchedAt);
  assert.equal(h.requests.length, 5);
  assert.equal(h.clock.nextDue, 900_000);
});

test('a first cache hit retains original cadence; overdue fetchedAt never creates an immediate retry loop', async () => {
  const h = harness(); h.open(); const cachedAt = h.clock.wall - 30_000;
  await h.success('cached', cachedAt); assert.equal(h.clock.nextDue, 30_000);
  h.clock.advance(30_000); await h.success('same cached value', cachedAt);
  assert.equal(h.clock.nextDue, 90_000);
  h.clock.advance(60_000); await h.success('still cached', cachedAt);
  assert.equal(h.clock.nextDue, 150_000);
  const old = harness(); old.open(); await old.success('old', old.clock.wall - 3_600_000);
  assert.equal(old.clock.nextDue, 60_000);
  const nearlyDue = harness(); nearlyDue.open(); await nearlyDue.success('near due', nearlyDue.clock.wall - 59_999);
  assert.equal(nearlyDue.clock.nextDue, 1000);
  const future = harness(); future.open(); await future.success('clock changed', future.clock.wall + 3_600_000);
  assert.equal(future.clock.nextDue, 60_000);
});

test('roads never auto-refresh or reload merely on resume, including an interrupted explicit request', async () => {
  const h = harness(null); h.open(); await h.success();
  assert.equal(h.clock.timerCount, 0); h.clock.jump(86_400_000);
  h.control.setActive(false); h.control.setActive(true); assert.equal(h.requests.length, 1);
  h.control.refresh(); assert.equal(h.requests.length, 2);
  h.control.setActive(false); await h.fail(); h.control.setActive(true);
  assert.equal(h.requests.length, 2); assert.equal(h.clock.timerCount, 0);
  h.control.refresh(); await h.fail({ kind: 'rate-limit' });
  assert.equal(h.clock.timerCount, 0, 'Road failures do not arm an automatic retry');
  h.control.refresh(); assert.equal(h.clock.nextDue - h.clock.mono, 60_000);
  h.clock.advance(60_000); assert.equal(h.requests.length, 4);
});

test('dispose invalidates the old query; late failures cannot reach its caller or schedule more work', async () => {
  const h = harness(); h.open(); h.control.dispose(); h.control.dispose();
  assert.equal(h.requests[0]!.signal.aborted, true); assert.equal(h.clock.timerCount, 0);
  await h.fail({ kind: 'rate-limit' }); h.control.setActive(true); h.control.refresh(); h.clock.jump(86_400_000);
  assert.equal(h.requests.length, 1); assert.deepEqual(h.errors, []); assert.deepEqual(h.successes, []);
});

test('queued provider work sees the aborted signal before transport starts', async () => {
  const clock = new FakeClock(); const providerReady = deferred<void>(); let transports = 0;
  const errors: unknown[] = []; const successes: string[] = [];
  const control = createActiveRefresh({ intervalMs: 60_000, timing: clock,
    load: async signal => {
      await providerReady.promise;
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      transports++; return { value: 'provider', fetchedAt: clock.wall };
    }, onSuccess: value => successes.push(value), onError: error => errors.push(error),
  });
  control.setActive(true); control.refresh(); control.setActive(false);
  providerReady.resolve(); await flush();
  assert.equal(transports, 0); assert.deepEqual(errors, []); assert.deepEqual(successes, []);
  control.setActive(true); clock.advance(60_000); await flush(); assert.equal(transports, 1);
});

test('synchronous visibility changes and throwing UI callbacks cannot start hidden loads or corrupt scheduling', async () => {
  const clock = new FakeClock(); let loads = 0;
  const control = createActiveRefresh({ intervalMs: 60_000, timing: clock,
    load: async () => { loads++; return { value: 'current', fetchedAt: clock.wall }; },
    onSuccess: () => { throw new Error('UI failure'); }, onError: () => { throw new Error('UI failure'); },
    onLoadingChange: value => { if (value) control.setActive(false); },
  });
  control.setActive(true); control.refresh(); await flush();
  assert.equal(loads, 0); assert.equal(clock.timerCount, 0);
  const throwing = createActiveRefresh({ intervalMs: 60_000, timing: clock,
    load: async () => ({ value: 'current', fetchedAt: clock.wall }),
    onSuccess: () => { throw new Error('UI failure'); }, onError: () => { throw new Error('Should not be a provider error'); },
    onLoadingChange: () => { throw new Error('UI failure'); },
  });
  throwing.setActive(true); throwing.refresh(); await flush(); assert.equal(clock.nextDue, 60_000);
});

test('new explicit intent after cancellation waits for settlement instead of overlapping or being lost', async () => {
  const h = harness(null);
  h.open(); h.control.setActive(false); h.control.setActive(true);
  h.control.refresh(); h.control.refresh();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0]!.signal.aborted, true);
  await h.success('cancelled');
  assert.deepEqual(h.successes, []);
  assert.equal(h.requests.length, 2, 'The new intent starts once the aborted slot settles');
  await h.success('requested');
  assert.deepEqual(h.successes, ['requested']);
  assert.equal(h.clock.timerCount, 0, 'An explicit road retry still never arms polling');
});

test('rate limiting enforces sixty seconds even when the resource interval is shorter', async () => {
  const h = harness(1_000);
  h.open(); await h.fail({ kind: 'rate-limit' }); h.control.refresh();
  assert.equal(h.clock.nextDue, 60_000);
  h.clock.advance(59_999); assert.equal(h.requests.length, 1);
  h.clock.advance(1); assert.equal(h.requests.length, 2);
  await h.success();
  assert.equal(h.clock.nextDue, 61_000);
});

test('invalid retrieval timestamps cannot cause loops or rewrite the delivered snapshot', async () => {
  for (const fetchedAt of [NaN, Infinity, -Infinity]) {
    const clock = new FakeClock();
    const value = Object.freeze({ fetchedAt });
    const received: typeof value[] = [];
    const errors: unknown[] = [];
    let loads = 0;
    const control = createActiveRefresh({
      intervalMs: 60_000, timing: clock,
      load: async () => { loads++; return { value, fetchedAt }; },
      onSuccess: result => received.push(result), onError: error => errors.push(error),
    });
    control.setActive(true); control.refresh(); await flush();
    assert.equal(clock.nextDue, 60_000);
    assert.equal(received[0], value);
    clock.advance(60_000); await flush();
    assert.equal(loads, 2);
    assert.equal(clock.nextDue, 120_000);
    assert.deepEqual(errors, []);
    control.dispose();
  }
});
