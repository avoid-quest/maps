import { SHEET_SNAPS, type SheetHeights, type SheetSnap } from '../../ui/sheet-snaps';
import { hasTaskAboveRoot, searchRoot, selectedPlace, sheetVisible, taskReducer, topTask, type TaskState } from './task-model';

export { SHEET_SNAPS, type SheetHeights, type SheetSnap };

/** Search bar, map controls and a strip of visible map stay above the fully expanded sheet. */
export const SHEET_TOP_RESERVE = 136;
const MIN_HEIGHT = 120;

const rank = (snap: SheetSnap) => SHEET_SNAPS.indexOf(snap);

/** The empty search shows only its shortcut row; every other task peeks at its title plus a row or two. */
export function peekContentHeight(tasks: TaskState, hasSearch: boolean): number {
  const search = searchRoot(tasks);
  return search?.inputOpen && !hasSearch && !selectedPlace(tasks) && !hasTaskAboveRoot(tasks) ? 152 : 220;
}

/**
 * Fixed heights per task and window, so asynchronous content never moves the sheet. A smaller window
 * (keyboard, split screen) shrinks the upper snaps first and never inverts their order.
 */
export function sheetHeights({ availableHeight, fontScale, peekContent }: { availableHeight: number; fontScale: number; peekContent: number }): SheetHeights {
  const full = Math.max(MIN_HEIGHT, availableHeight - SHEET_TOP_RESERVE);
  const peek = Math.min(full, Math.max(MIN_HEIGHT, Math.round(peekContent * Math.min(Math.max(fontScale, 1), 1.5))));
  const half = Math.min(full, Math.max(peek, Math.round(availableHeight * 0.5)));
  return { peek, half, full };
}

/** Where a task opens: content-first tasks (results, stops, routes) share the screen; a place peeks. */
export function defaultSnap(tasks: TaskState, hasSearch: boolean): SheetSnap {
  const top = topTask(tasks);
  switch (top.kind) {
    case 'settings': return 'full';
    case 'place': return 'peek';
    case 'search': return hasSearch ? 'half' : 'peek';
    case 'browse': return 'peek';
    default: return 'half';
  }
}

export const resolveSnap = (requested: SheetSnap | null, fallback: SheetSnap): SheetSnap => requested ?? fallback;
export function nextSnapUp(snap: SheetSnap): SheetSnap { return SHEET_SNAPS[Math.min(rank(snap) + 1, SHEET_SNAPS.length - 1)]!; }
export function nextSnapDown(snap: SheetSnap): SheetSnap { return SHEET_SNAPS[Math.max(rank(snap) - 1, 0)]!; }
/** The header control: expand one step, or from full return to the task's resting height. */
export function toggledSnap(snap: SheetSnap, fallback: SheetSnap): SheetSnap {
  return snap === 'full' ? (fallback === 'full' ? 'half' : fallback) : nextSnapUp(snap);
}

/**
 * Android Back after the keyboard and active guidance: a sheet the user raised above its resting
 * height comes down first, then the task stack unwinds, and only the bare map exits the app.
 */
export type SheetBackStep = 'collapse' | 'task' | 'exit';
export function sheetBackStep(tasks: TaskState, snap: SheetSnap, resting: SheetSnap): SheetBackStep {
  if (sheetVisible(tasks) && rank(snap) > rank(resting)) return 'collapse';
  if (!sheetVisible(tasks)) return 'exit';
  return 'task';
}

/**
 * The sheet header's way out. Close always returns to the map; Back appears only when the task
 * beneath is something other than the map, so the two controls never do the same thing.
 */
export function sheetHeaderNavigation(tasks: TaskState): { back: boolean; close: true } {
  const beneath = taskReducer(tasks, { type: 'closeTopTask' });
  return { back: hasTaskAboveRoot(tasks) && sheetVisible(beneath), close: true };
}
