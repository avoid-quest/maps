import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '../../domain/types';
import { initialTaskState, taskReducer, type TaskAction } from './task-model';
import { createTaskStore } from './task-store';

const cafe: Place = { id: 'cafe', name: 'Caffè', coordinate: { latitude: 45.07, longitude: 7.68 }, source: 'Test', attributions: [] };
/** React's reducer replays enqueued actions in order; it must reach the synchronous state. */
function reactMirror() {
  const queued: TaskAction[] = [];
  return { apply: (action: TaskAction) => { queued.push(action); }, replay: () => queued.reduce(taskReducer, initialTaskState) };
}

test('listeners see each transition synchronously and unchanged actions are skipped', () => {
  const react = reactMirror();
  const store = createTaskStore(react.apply);
  const seen: string[] = [];
  const unsubscribe = store.subscribe((previous, next) => seen.push(`${previous.root.kind}>${next.root.kind}:${store.getState() === next}`));
  store.dispatch({ type: 'openTab', tab: 'transit' });
  store.dispatch({ type: 'back' });
  store.dispatch({ type: 'back' });
  unsubscribe();
  store.dispatch({ type: 'openTab', tab: 'saved' });
  assert.deepEqual(seen, ['browse>transit:true', 'transit>browse:true']);
  assert.deepEqual(react.replay(), store.getState());
});

test('a listener that dispatches keeps React in the same order as the synchronous state', () => {
  const react = reactMirror();
  const store = createTaskStore(react.apply);
  // The follow-up depends on the outer transition: it plans to the place just opened.
  store.subscribe((previous, next) => {
    if (!previous.details.length && next.details[0]?.kind === 'place') store.dispatch({ type: 'beginRoute', viewport: cafe.coordinate, locating: false });
  });
  store.dispatch({ type: 'focusSearch' });
  store.dispatch({ type: 'openPlace', place: cafe });
  assert.deepEqual(store.getState().details.map(task => task.kind), ['place', 'planner']);
  assert.deepEqual(react.replay(), store.getState());
});

test('a throwing listener cannot leave React behind the synchronous state', () => {
  const react = reactMirror();
  const store = createTaskStore(react.apply);
  store.subscribe(() => { throw new Error('listener failed'); });
  assert.throws(() => store.dispatch({ type: 'openTab', tab: 'saved' }), /listener failed/);
  assert.equal(store.getState().root.kind, 'saved');
  assert.deepEqual(react.replay(), store.getState());
});
