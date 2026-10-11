import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppStateStatus } from 'react-native';
import { createActiveRefresh } from './active-refresh';
import { FakeClock, deferred, flush } from './active-refresh.test-support';
import { subscribeAppActive } from './app-active';

class FakeAppState {
  currentState: AppStateStatus | null = null;
  private listeners = new Set<(state: AppStateStatus) => void>();
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void) {
    assert.equal(type, 'change');
    this.listeners.add(listener);
    return { remove: () => { this.listeners.delete(listener); } };
  }
  emit(state: AppStateStatus) {
    this.currentState = state;
    this.listeners.forEach(listener => listener(state));
  }
}

test('AppState subscription reconciles initial activity and reports inactive states synchronously', () => {
  const source = new FakeAppState();
  const activity: boolean[] = [];
  const unsubscribe = subscribeAppActive(source, active => activity.push(active));
  assert.deepEqual(activity, [false], 'Unknown launch state does not authorize requests');
  source.emit('active'); assert.deepEqual(activity, [false, true]);
  source.emit('inactive'); assert.deepEqual(activity, [false, true, false]);
  source.emit('background'); assert.deepEqual(activity, [false, true, false, false]);
  unsubscribe(); source.emit('active');
  assert.deepEqual(activity, [false, true, false, false]);

  source.currentState = 'background';
  const stop = subscribeAppActive(source, active => activity.push(active));
  assert.equal(activity.at(-1), false, 'A transition before subscription is reconciled immediately');
  stop();
});

test('one AppState handler suspends both resources before queued transport or a rendered state update', async () => {
  const source = new FakeAppState();
  source.currentState = 'active';
  const clock = new FakeClock();
  const providerReady = deferred<void>();
  const signals: AbortSignal[] = [];
  const received: string[] = [];
  const errors: unknown[] = [];
  let transports = 0;
  let renderedActive = true;
  const controls = [60_000, 300_000].map(intervalMs => createActiveRefresh({
    intervalMs, timing: clock,
    load: async signal => {
      signals.push(signal);
      await providerReady.promise;
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      transports++;
      return { value: 'current', fetchedAt: clock.wall };
    },
    onSuccess: value => received.push(value), onError: error => errors.push(error),
  }));
  const unsubscribe = subscribeAppActive(source, active => {
    if (!active) {
      controls.forEach(control => control.setActive(false));
      assert.equal(renderedActive, true, 'Controllers stop before the view state update');
      assert.equal(signals.every(signal => signal.aborted), true);
    }
    renderedActive = active;
  });
  controls.forEach(control => { control.setActive(true); control.refresh(); });
  providerReady.resolve();
  source.emit('background');
  assert.equal(signals.length, 2);
  assert.equal(signals.every(signal => signal.aborted), true, 'Abort happens within the native/web change callback');
  assert.equal(clock.timerCount, 0);
  await flush();
  assert.equal(transports, 0);
  assert.deepEqual(received, []);
  assert.deepEqual(errors, [], 'Cancellation stays silent');

  clock.jump(3_600_000);
  source.emit('active');
  assert.equal(transports, 0, 'Activation still waits for the complete view predicate');
  controls.forEach(control => control.setActive(true));
  await flush();
  assert.equal(transports, 2, 'Resume permits one overdue request for each visible resource');
  assert.deepEqual(received, ['current', 'current']);
  unsubscribe();
  controls.forEach(control => control.dispose());
  assert.equal(clock.timerCount, 0);
});
