import test from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinate, Place, Stop } from '../../domain/types';
import {
  boardInFront, boardStop, detailKey, hasTaskAboveRoot, initialTaskState, isValidTaskState, journeyStop, ORIGIN_LABELS,
  plannerInFront, plannerTask, selectedPlace, sheetVisible, taskReducer, topTask, type TaskAction, type TaskState,
} from './task-model';

const viewport: Coordinate = { latitude: 45.07, longitude: 7.68 };
const here: Coordinate = { latitude: 45.06, longitude: 7.66 };
const cafe: Place = { id: 'cafe', name: 'Caffè', coordinate: { latitude: 45.071, longitude: 7.685 }, source: 'Test', attributions: [] };
const museum: Place = { id: 'museum', name: 'Museo', coordinate: { latitude: 45.068, longitude: 7.693 }, source: 'Test', attributions: [] };
const porta: Stop = { id: '470', code: '470', name: 'Porta Nuova', coordinate: { latitude: 45.062, longitude: 7.678 }, lines: ['4'] };
const vinzaglio: Stop = { id: '1', code: '1', name: 'Vinzaglio', coordinate: { latitude: 45.07, longitude: 7.67 }, lines: ['55'] };

function run(...actions: TaskAction[]): TaskState {
  return actions.reduce((state, action) => {
    const next = taskReducer(state, action);
    assert.ok(isValidTaskState(next), `${action.type} produced ${next.details.map(task => task.kind).join(',')}`);
    return next;
  }, initialTaskState);
}
const kinds = (state: TaskState) => [state.root.kind, ...state.details.map(task => task.kind), ...state.settings ? ['settings'] : []];

test('launch is the unselected map without a sheet or task', () => {
  assert.deepEqual(kinds(initialTaskState), ['browse']);
  assert.equal(sheetVisible(initialTaskState), false);
  assert.equal(hasTaskAboveRoot(initialTaskState), false);
  assert.equal(detailKey(initialTaskState), 'list:explore');
  assert.equal(taskReducer(initialTaskState, { type: 'back' }), initialTaskState, 'Back on the idle map is not handled');
});

test('Back unwinds journey stop, planner, place and results in order, preserving return context', () => {
  let state = run(
    { type: 'focusSearch' }, { type: 'chooseCategory', category: 'bar' }, { type: 'openPlace', place: cafe },
    { type: 'beginRoute', viewport, locating: true }, { type: 'originLocated', coordinate: here },
    { type: 'openJourneyStop', stop: porta },
  );
  assert.deepEqual(kinds(state), ['search', 'place', 'planner', 'journeyStop']);
  const session = plannerTask(state)!.session;
  assert.equal(boardStop(state)?.id, porta.id);
  assert.equal(plannerInFront(state), false, 'A journey stop pauses planning requests');

  state = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(state), ['search', 'place', 'planner']);
  assert.equal(plannerTask(state)!.session, session, 'Returning keeps the same planning session');
  assert.deepEqual(plannerTask(state)!.origin, { coordinate: here, label: ORIGIN_LABELS.device, ready: true });
  assert.equal(plannerInFront(state), true);

  state = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(state), ['search', 'place']);
  assert.equal(selectedPlace(state)?.id, cafe.id);
  state = taskReducer(state, { type: 'back' });
  assert.deepEqual(state.root, { kind: 'search', category: 'bar', inputOpen: false }, 'Results remain for their category');
  state = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(state), ['browse']);
  assert.equal(sheetVisible(state), false);
});

test('origin picking is its own Back step only when an origin is already settled', () => {
  const placeOpen = run({ type: 'focusSearch' }, { type: 'openPlace', place: cafe });
  let state = taskReducer(placeOpen, { type: 'beginRoute', viewport, locating: false });
  assert.equal(plannerTask(state)!.originStep, 'picking', 'Without a position the planner asks for a map origin');
  assert.deepEqual(plannerTask(state)!.origin, { coordinate: viewport, label: ORIGIN_LABELS.unset, ready: false });
  assert.deepEqual(kinds(taskReducer(state, { type: 'back' })), ['search', 'place'], 'Cancelling the first origin returns to the destination');
  assert.deepEqual(kinds(taskReducer(state, { type: 'cancelOriginPicking' })), ['search', 'place']);

  state = run({ type: 'focusSearch' }, { type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false },
    { type: 'setOrigin', coordinate: here }, { type: 'pickOrigin' });
  assert.equal(plannerInFront(state), false);
  const back = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(back), ['search', 'place', 'planner']);
  assert.equal(plannerTask(back)!.originStep, 'idle');
  assert.equal(plannerTask(back)!.origin.label, ORIGIN_LABELS.map, 'The previous origin survives cancelled picking');
  assert.deepEqual(kinds(taskReducer(state, { type: 'closeTopTask' })), ['search', 'place'], 'The sheet arrow closes the planner');
});

test('device origin requests settle only the step that is waiting for them', () => {
  const planning = run({ type: 'openTab', tab: 'saved' }, { type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: true });
  assert.equal(plannerTask(planning)!.originStep, 'locating');
  assert.equal(plannerInFront(planning), false);
  assert.equal(plannerTask(taskReducer(planning, { type: 'originLocateFailed' }))!.originStep, 'picking');
  assert.equal(plannerTask(taskReducer(planning, { type: 'locationRequestCancelled' }))!.originStep, 'idle');
  assert.equal(plannerTask(taskReducer(planning, { type: 'locationRequestCancelled' }))!.origin.ready, false, 'Cancellation never invents an origin');

  const picked = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false }, { type: 'setOrigin', coordinate: here });
  assert.equal(taskReducer(picked, { type: 'originLocated', coordinate: viewport }), picked, 'A late fix cannot replace a chosen origin');
  assert.equal(taskReducer(picked, { type: 'setOrigin', coordinate: viewport }), picked, 'Map taps set an origin only while picking');
  assert.equal(taskReducer(initialTaskState, { type: 'locationRequestCancelled' }), initialTaskState);
});

test('locating from the planner closes a journey stop and clears the settled origin', () => {
  const state = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false },
    { type: 'setOrigin', coordinate: here }, { type: 'openJourneyStop', stop: porta }, { type: 'locateOrigin' });
  assert.deepEqual(kinds(state), ['browse', 'place', 'planner']);
  assert.equal(plannerTask(state)!.originStep, 'locating');
  assert.equal(plannerTask(state)!.origin.ready, false);
  assert.equal(plannerTask(state)!.origin.label, ORIGIN_LABELS.map, 'The previous label remains visible while locating');
  assert.equal(taskReducer(initialTaskState, { type: 'locateOrigin' }), initialTaskState);
});

test('settings overlay the current task and Back closes it before anything beneath', () => {
  let state = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false }, { type: 'toggleSettings' });
  assert.equal(topTask(state).kind, 'settings');
  assert.equal(plannerInFront(state), false);
  assert.equal(detailKey(state), 'privacy');
  state = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(state), ['browse', 'place', 'planner'], 'Picking resumes under closed settings');
  assert.equal(plannerTask(state)!.originStep, 'picking');

  state = run({ type: 'openTab', tab: 'transit' }, { type: 'toggleSettings' }, { type: 'openStop', stop: porta });
  assert.deepEqual(kinds(state), ['transit', 'stop', 'settings'], 'Map selections keep settings on top');
  assert.equal(boardStop(state)?.id, porta.id);
  assert.equal(boardInFront(state), false, 'A board under settings keeps its stop but pauses');
  assert.deepEqual(kinds(taskReducer(state, { type: 'closeDetails' })), ['transit', 'settings']);
  assert.deepEqual(kinds(taskReducer(state, { type: 'toggleSettings' })), ['transit', 'stop']);
  assert.deepEqual(kinds(taskReducer(state, { type: 'focusSearch' })), ['search'], 'Search replaces every task');
});

test('stop directions replace the board with the stop as a place, then plan on foot', () => {
  const stopPlace: Place = { id: `stop:${porta.id}`, name: `Fermata ${porta.name}`, coordinate: porta.coordinate, source: 'GTT', attributions: [] };
  let state = run({ type: 'openTab', tab: 'transit' }, { type: 'setTravelMode', mode: 'car' }, { type: 'openStop', stop: porta },
    { type: 'beginRoute', destination: stopPlace, mode: 'walk', viewport, locating: true });
  assert.deepEqual(kinds(state), ['transit', 'place', 'planner']);
  assert.equal(state.travel.mode, 'walk');
  assert.equal(boardStop(state), null);
  state = taskReducer(taskReducer(state, { type: 'back' }), { type: 'back' });
  assert.deepEqual(kinds(state), ['transit']);
});

test('the last travel choice carries into the next planner', () => {
  const state = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: true },
    { type: 'setTravelMode', mode: 'transit' }, { type: 'setTransitTime', transitTime: { kind: 'depart-at', date: '2026-11-02', time: '08:00' } },
    { type: 'openTab', tab: 'browse' }, { type: 'focusSearch' }, { type: 'openPlace', place: museum }, { type: 'beginRoute', viewport, locating: true });
  assert.equal(state.travel.mode, 'transit');
  assert.deepEqual(state.travel.transitTime, { kind: 'depart-at', date: '2026-11-02', time: '08:00' });
  assert.equal(plannerTask(state)!.session, 2);
  assert.equal(taskReducer(state, { type: 'setTravelMode', mode: 'transit' }), state);
});

test('a restored journey opens its planner over Salvati and Back returns there', () => {
  const state = run({ type: 'openTab', tab: 'saved' }, { type: 'restoreJourney', destination: museum,
    origin: { coordinate: here, label: 'Casa' }, travel: { mode: 'transit', transitTime: { kind: 'now' } } });
  assert.deepEqual(kinds(state), ['saved', 'planner']);
  assert.deepEqual(plannerTask(state)!.origin, { coordinate: here, label: 'Casa', ready: true });
  assert.equal(plannerInFront(state), true);
  assert.equal(selectedPlace(state)?.id, museum.id);
  assert.deepEqual(kinds(taskReducer(state, { type: 'back' })), ['saved']);
  assert.deepEqual(kinds(taskReducer(state, { type: 'closeDetails' })), ['saved']);
});

test('transit replanning keeps the current destination and starts a new session', () => {
  const navigating = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: true }, { type: 'originLocated', coordinate: here });
  const session = plannerTask(navigating)!.session;
  const sameDestination: Place = { ...cafe, id: 'navigation-destination', name: 'Destinazione del viaggio' };
  let state = taskReducer(navigating, { type: 'replan', destination: sameDestination, from: viewport, viewport });
  assert.deepEqual(kinds(state), ['browse', 'place', 'planner']);
  assert.equal(selectedPlace(state)?.id, cafe.id);
  assert.notEqual(plannerTask(state)!.session, session);
  assert.deepEqual(plannerTask(state)!.origin, { coordinate: viewport, label: ORIGIN_LABELS.replan, ready: true });
  assert.deepEqual(state.travel, { mode: 'transit', transitTime: { kind: 'now' } });

  state = taskReducer(navigating, { type: 'replan', destination: { ...sameDestination, coordinate: museum.coordinate }, viewport });
  assert.deepEqual(kinds(state), ['browse', 'planner']);
  assert.equal(selectedPlace(state)?.name, 'Destinazione del viaggio');
  assert.equal(plannerTask(state)!.originStep, 'picking', 'Without a guidance position the origin is chosen again');
  assert.deepEqual(plannerTask(state)!.origin, { coordinate: here, label: ORIGIN_LABELS.device, ready: false });

  const resumed = taskReducer(initialTaskState, { type: 'replan', destination: sameDestination, viewport });
  assert.deepEqual(kinds(resumed), ['browse', 'planner']);
  assert.deepEqual(plannerTask(resumed)!.origin, { coordinate: viewport, label: ORIGIN_LABELS.unset, ready: false });
});

test('search transitions keep a category on focus and replace it when typing', () => {
  const category = run({ type: 'focusSearch' }, { type: 'chooseCategory', category: 'bar' });
  assert.deepEqual(category.root, { kind: 'search', category: 'bar', inputOpen: false });
  assert.deepEqual(taskReducer(category, { type: 'focusSearch' }).root, { kind: 'search', category: 'bar', inputOpen: true });
  assert.deepEqual(taskReducer(category, { type: 'editQuery' }).root, { kind: 'search', category: '', inputOpen: true });
  assert.deepEqual(run({ type: 'openTab', tab: 'transit' }, { type: 'focusSearch' }).root, { kind: 'search', category: '', inputOpen: true });
  const opened = taskReducer(taskReducer(category, { type: 'focusSearch' }), { type: 'openPlace', place: cafe });
  assert.deepEqual(opened.root, { kind: 'search', category: 'bar', inputOpen: false }, 'Opening a result closes the input');
  assert.deepEqual(kinds(taskReducer(opened, { type: 'closeTopTask' })), ['search']);
  assert.deepEqual(kinds(taskReducer(taskReducer(opened, { type: 'closeTopTask' }), { type: 'closeTopTask' })), ['browse']);
});

test('journey stops open only from a planner in front', () => {
  assert.equal(taskReducer(initialTaskState, { type: 'openJourneyStop', stop: porta }), initialTaskState);
  const settings = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false }, { type: 'toggleSettings' });
  assert.equal(taskReducer(settings, { type: 'openJourneyStop', stop: porta }), settings);
  const state = run({ type: 'openPlace', place: cafe }, { type: 'beginRoute', viewport, locating: false },
    { type: 'setOrigin', coordinate: here }, { type: 'openJourneyStop', stop: porta });
  assert.equal(journeyStop(state)?.id, porta.id);
  assert.equal(detailKey(state), `journey-stop:${porta.id}`);
  assert.equal(boardInFront(state), true);
  assert.deepEqual(kinds(taskReducer(state, { type: 'openStop', stop: vinzaglio })), ['browse', 'stop'], 'A saved stop replaces the journey');
});

test('every reachable action sequence keeps a valid task stack', () => {
  let seed = 7;
  const random = (limit: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % limit; };
  const actions: TaskAction[] = [
    { type: 'openTab', tab: 'transit' }, { type: 'openTab', tab: 'saved' }, { type: 'openTab', tab: 'browse' },
    { type: 'focusSearch' }, { type: 'editQuery' }, { type: 'chooseCategory', category: 'bar' },
    { type: 'openPlace', place: cafe }, { type: 'openStop', stop: porta },
    { type: 'beginRoute', viewport, locating: true }, { type: 'beginRoute', destination: museum, viewport, locating: false },
    { type: 'restoreJourney', destination: museum, origin: { coordinate: here, label: 'Casa' }, travel: { mode: 'walk', transitTime: { kind: 'now' } } },
    { type: 'replan', viewport }, { type: 'replan', destination: museum, from: here, viewport },
    { type: 'locateOrigin' }, { type: 'originLocated', coordinate: here }, { type: 'originLocateFailed' }, { type: 'locationRequestCancelled' },
    { type: 'pickOrigin' }, { type: 'setOrigin', coordinate: viewport }, { type: 'cancelOriginPicking' },
    { type: 'openJourneyStop', stop: vinzaglio }, { type: 'toggleSettings' }, { type: 'closeDetails' },
    { type: 'closeTopTask' }, { type: 'back' },
  ];
  let state = initialTaskState;
  for (let step = 0; step < 5000; step++) {
    const action = actions[random(actions.length)]!;
    state = taskReducer(state, action);
    assert.ok(isValidTaskState(state), `step ${step} ${action.type}: ${kinds(state).join(',')}`);
    const planner = plannerTask(state);
    if (planner?.originStep === 'locating') assert.equal(planner.origin.ready, false);
  }
  for (let step = 0; step < 6; step++) state = taskReducer(state, { type: 'back' });
  assert.deepEqual(kinds(state), ['browse'], 'Back always reaches the map');
});
