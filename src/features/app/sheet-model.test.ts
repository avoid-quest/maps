import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place, Stop } from '../../domain/types';
import { defaultSnap, dismissesKeyboard, nextSnapDown, nextSnapUp, peekContentHeight, sheetBackStep, sheetHeaderNavigation, sheetHeights, SHEET_TOP_RESERVE, toggledSnap } from './sheet-model';
import { initialTaskState, taskReducer, type TaskAction, type TaskState } from './task-model';

const place: Place = { id: 'p', name: 'Mole Antonelliana', coordinate: { latitude: 45.069, longitude: 7.693 }, source: 'Test', attributions: [] };
const stop: Stop = { id: 's', code: '470', name: 'Porta Nuova', coordinate: { latitude: 45.062, longitude: 7.678 }, lines: ['4'] };
const run = (...actions: TaskAction[]): TaskState => actions.reduce(taskReducer, initialTaskState);

test('snap heights are ordered, fixed per window and leave the search bar visible', () => {
  for (const availableHeight of [480, 640, 760, 900]) for (const fontScale of [0.85, 1, 1.3, 2]) for (const peekContent of [152, 220]) {
    const { peek, half, full } = sheetHeights({ availableHeight, fontScale, peekContent });
    assert.ok(peek <= half && half <= full, `${availableHeight}/${fontScale}: ${peek} ${half} ${full}`);
    assert.ok(full <= Math.max(120, availableHeight - SHEET_TOP_RESERVE));
    assert.ok(peek >= 120);
  }
  const keyboard = sheetHeights({ availableHeight: 380, fontScale: 1, peekContent: 220 });
  assert.equal(keyboard.full, 244, 'a keyboard-shrunk window lowers the full snap rather than covering the search bar');
  assert.equal(keyboard.peek, 220);
});

test('each task opens at a resting height that shows its primary content', () => {
  assert.equal(defaultSnap(run({ type: 'focusSearch' }), false), 'peek', 'empty search shows its shortcut row');
  assert.equal(peekContentHeight(run({ type: 'focusSearch' }), false), 152);
  assert.equal(defaultSnap(run({ type: 'editQuery' }), true), 'half', 'results share the screen with their pins');
  assert.equal(defaultSnap(run({ type: 'openPlace', place }), false), 'peek');
  assert.equal(defaultSnap(run({ type: 'openTab', tab: 'transit' }, { type: 'openStop', stop }), false), 'half', 'departures are above the fold');
  assert.equal(defaultSnap(run({ type: 'toggleSettings' }), false), 'full');
});

test('the expand control steps up and returns to the resting height from full', () => {
  assert.equal(nextSnapUp('peek'), 'half');
  assert.equal(nextSnapUp('full'), 'full');
  assert.equal(nextSnapDown('peek'), 'peek');
  assert.equal(toggledSnap('peek', 'peek'), 'half');
  assert.equal(toggledSnap('half', 'peek'), 'full');
  assert.equal(toggledSnap('full', 'peek'), 'peek');
  assert.equal(toggledSnap('full', 'full'), 'half', 'a task resting at full can still be reduced');
});

test('Back lowers a raised sheet before unwinding tasks, and exits only from the bare map', () => {
  const stopBoard = run({ type: 'openTab', tab: 'transit' }, { type: 'openStop', stop });
  assert.equal(sheetBackStep(stopBoard, 'full', 'half'), 'collapse');
  assert.equal(sheetBackStep(stopBoard, 'half', 'half'), 'task');
  assert.equal(sheetBackStep(stopBoard, 'peek', 'half'), 'task', 'a lowered sheet is not raised by Back');
  assert.equal(sheetBackStep(run({ type: 'openTab', tab: 'saved' }), 'half', 'half'), 'task', 'a root task closes to the map');
  assert.equal(sheetBackStep(initialTaskState, 'peek', 'peek'), 'exit');
});

test('the header shows Back only when it leads somewhere other than the map', () => {
  assert.deepEqual(sheetHeaderNavigation(run({ type: 'openTab', tab: 'transit' })), { back: false, close: true }, 'root task: Close only');
  assert.deepEqual(sheetHeaderNavigation(run({ type: 'openTab', tab: 'transit' }, { type: 'openStop', stop })), { back: true, close: true }, 'stop above Trasporti');
  assert.deepEqual(sheetHeaderNavigation(run({ type: 'openPlace', place })), { back: false, close: true }, 'a place opened from the bare map');
  assert.deepEqual(sheetHeaderNavigation(run({ type: 'toggleSettings' })), { back: false, close: true });
  assert.deepEqual(sheetHeaderNavigation(run({ type: 'openTab', tab: 'saved' }, { type: 'toggleSettings' })), { back: true, close: true }, 'settings over Salvati returns to Salvati');
});

test('a short window with shared heights keeps logical snaps, camera padding and controls consistent', async () => {
  const { logicalSnapAt, physicalIndex, physicalSnaps } = await import('../../ui/sheet-snaps');
  const keyboard = sheetHeights({ availableHeight: 380, fontScale: 1, peekContent: 220 });
  assert.deepEqual(keyboard, { peek: 220, half: 220, full: 244 });
  assert.deepEqual(physicalSnaps(keyboard), [220, 244], 'the gesture library never sees duplicate detents');
  assert.equal(physicalIndex(keyboard, 'half'), 0);
  assert.equal(physicalIndex(keyboard, 'peek'), 0);
  assert.equal(physicalIndex(keyboard, 'full'), 1);
  assert.equal(logicalSnapAt(keyboard, 0, 'half'), 'half', 'reaching the shared height keeps "half", not "peek"');
  assert.equal(logicalSnapAt(keyboard, 1, 'half'), 'full');
  assert.equal(logicalSnapAt(keyboard, 0, 'full'), 'peek', 'dragging down lands on the lowest snap at that height');
  assert.equal(logicalSnapAt(sheetHeights({ availableHeight: 380, fontScale: 1, peekContent: 140 }), 1, 'peek'), 'half');
  assert.equal(toggledSnap('peek', 'peek', keyboard), 'full', 'the expand control skips a snap of the same height');
  assert.equal(toggledSnap('full', 'half', keyboard), 'half');
  const tall = { peek: 220, half: 244, full: 244 };
  assert.equal(toggledSnap('full', 'half', tall), 'peek', 'from the top, the control always moves the sheet');
  assert.equal(sheetBackStep(run({ type: 'openTab', tab: 'transit' }, { type: 'openStop', stop }), 'full', 'half', tall), 'task', 'Back does not "collapse" to an identical height');
});

test('only the explicit expand control dismisses the keyboard; library-reported heights never do', () => {
  assert.equal(dismissesKeyboard('half', 'full', true), true);
  assert.equal(dismissesKeyboard(null, 'full', true), true);
  // The keyboard opening over a results sheet makes the library report its highest snap.
  assert.equal(dismissesKeyboard('half', 'full', false), false);
  assert.equal(dismissesKeyboard('full', 'full', true), false);
  assert.equal(dismissesKeyboard('full', 'half', true), false);
});
