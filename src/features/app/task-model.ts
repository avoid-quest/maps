import type { Coordinate, Place, Stop, TransitTime, TravelMode } from '../../domain/types';

/**
 * Which screen the user is in, as a small stack: one root, the detail tasks opened
 * from it, and Privacy e fonti as an overlay on top. The model owns task choices only.
 * Fetched payloads, GPS samples and per-keystroke search text stay in feature hooks.
 */
export type RootTask =
  | { kind: 'browse' }
  /** `category` is a shortcut choice; typed text lives in the search hook. */
  | { kind: 'search'; category: string; inputOpen: boolean }
  | { kind: 'transit' }
  | { kind: 'saved' };
export type RootTab = 'browse' | 'transit' | 'saved';

/** idle: origin settled or unset; locating: awaiting a fresh fix; picking: awaiting a map tap. */
export type OriginStep = 'idle' | 'locating' | 'picking';
export interface PlannerOrigin { coordinate: Coordinate; label: string; ready: boolean }
export interface PlannerTask {
  kind: 'planner';
  /** Changes whenever a different planning session replaces this one. */
  session: number;
  destination: Place;
  origin: PlannerOrigin;
  originStep: OriginStep;
}
export interface PlaceTask { kind: 'place'; place: Place }
export interface StopTask { kind: 'stop'; stop: Stop }
/** A stop board opened from a journey; closing it returns to its planner. */
export interface JourneyStopTask { kind: 'journeyStop'; stop: Stop }
export type DetailTask = PlaceTask | StopTask | PlannerTask | JourneyStopTask;
export interface SettingsTask { kind: 'settings' }
export type Task = RootTask | DetailTask | SettingsTask;

export interface TravelChoice { mode: TravelMode; transitTime: TransitTime }
export interface TaskState {
  root: RootTask;
  /** Valid sequences: [], [place], [stop], [place?, planner, journeyStop?]. */
  details: readonly DetailTask[];
  settings: boolean;
  /** The last chosen mode and time carry over to the next planner. */
  travel: TravelChoice;
  sessions: number;
}

export const ORIGIN_LABELS = {
  unset: 'Scegli sulla mappa',
  device: 'La tua posizione',
  map: 'Punto sulla mappa',
  replan: 'La tua posizione alla richiesta di aggiornamento',
} as const;

export const initialTaskState: TaskState = {
  root: { kind: 'browse' }, details: [], settings: false,
  travel: { mode: 'walk', transitTime: { kind: 'now' } }, sessions: 0,
};

export type TaskAction =
  /** Changes the root and closes every task above it, including settings. */
  | { type: 'openTab'; tab: RootTab }
  | { type: 'focusSearch' }
  | { type: 'editQuery' }
  | { type: 'chooseCategory'; category: string }
  | { type: 'openPlace'; place: Place }
  | { type: 'openStop'; stop: Stop }
  /** Plans to `destination`, or to the open place. `locating` reflects a usable device position. */
  | { type: 'beginRoute'; destination?: Place; mode?: TravelMode; viewport: Coordinate; locating: boolean }
  | { type: 'restoreJourney'; destination: Place; origin: { coordinate: Coordinate; label: string }; travel: TravelChoice }
  /** Rebuilds a transit planner after guidance stopped; `from` is the last accepted guidance position. */
  | { type: 'replan'; destination?: Place; from?: Coordinate; viewport: Coordinate }
  | { type: 'locateOrigin' }
  | { type: 'originLocated'; coordinate: Coordinate }
  | { type: 'originLocateFailed' }
  | { type: 'locationRequestCancelled' }
  | { type: 'pickOrigin' }
  | { type: 'setOrigin'; coordinate: Coordinate }
  | { type: 'cancelOriginPicking' }
  | { type: 'setTravelMode'; mode: TravelMode }
  | { type: 'setTransitTime'; transitTime: TransitTime }
  | { type: 'openJourneyStop'; stop: Stop }
  | { type: 'toggleSettings' }
  /** Closes place, stop and planner tasks, keeping the root and settings. */
  | { type: 'closeDetails' }
  /** The sheet's back arrow: closes the top task, or returns an idle root to the map. */
  | { type: 'closeTopTask' }
  /** Android Back: like closeTopTask, but origin picking is its own step. */
  | { type: 'back' };

const settingsTask: SettingsTask = { kind: 'settings' };
const browse: RootTask = { kind: 'browse' };
function tabRoot(tab: RootTab): RootTask { return tab === 'browse' ? browse : { kind: tab }; }
function last<T>(items: readonly T[]): T | undefined { return items[items.length - 1]; }
function details(state: TaskState, next: readonly DetailTask[]): TaskState {
  return next.length === 0 && state.details.length === 0 ? state : { ...state, details: next };
}
function updatePlanner(state: TaskState, update: (planner: PlannerTask) => PlannerTask | null): TaskState {
  const index = state.details.findIndex(task => task.kind === 'planner');
  const planner = state.details[index] as PlannerTask | undefined;
  if (!planner) return state;
  const next = update(planner);
  if (next === planner) return state;
  // Removing a planner also removes the journey stop opened from it.
  return { ...state, details: next ? [...state.details.slice(0, index), next, ...state.details.slice(index + 1)] : state.details.slice(0, index) };
}
function newPlanner(state: TaskState, destination: Place, origin: PlannerOrigin, originStep: OriginStep): [TaskState, PlannerTask] {
  const sessions = state.sessions + 1;
  return [{ ...state, sessions }, { kind: 'planner', session: sessions, destination, origin, originStep }];
}
function openPlace(state: TaskState, place: Place): TaskState {
  const root = state.root.kind === 'search' && state.root.inputOpen ? { ...state.root, inputOpen: false } : state.root;
  return { ...state, root, details: [{ kind: 'place', place }] };
}
function sameCoordinate(a: Coordinate, b: Coordinate) {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}
function closeTop(state: TaskState): TaskState {
  if (state.settings) return { ...state, settings: false };
  if (state.details.length) return { ...state, details: state.details.slice(0, -1) };
  return state.root.kind === 'browse' ? state : { ...state, root: browse };
}
function cancelPicking(planner: PlannerTask): PlannerTask | null {
  return planner.origin.ready ? { ...planner, originStep: 'idle' } : null;
}

export function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'openTab':
      return { ...state, root: tabRoot(action.tab), details: [], settings: false };
    case 'focusSearch': {
      // Focusing keeps a chosen category; typing replaces it.
      const category = state.root.kind === 'search' ? state.root.category : '';
      return { ...state, root: { kind: 'search', category, inputOpen: true }, details: [], settings: false };
    }
    case 'editQuery':
      return { ...state, root: { kind: 'search', category: '', inputOpen: true }, details: [], settings: false };
    case 'chooseCategory':
      return { ...state, root: { kind: 'search', category: action.category, inputOpen: false } };
    case 'openPlace':
      return openPlace(state, action.place);
    case 'openStop':
      return { ...state, details: [{ kind: 'stop', stop: action.stop }] };
    case 'beginRoute': {
      const base = action.destination ? openPlace(state, action.destination) : state;
      const place = last(base.details);
      if (place?.kind !== 'place') return state;
      const [next, planner] = newPlanner(base, place.place,
        { coordinate: action.viewport, label: ORIGIN_LABELS.unset, ready: false }, action.locating ? 'locating' : 'picking');
      return { ...next, details: [place, planner], travel: action.mode ? { ...next.travel, mode: action.mode } : next.travel };
    }
    case 'restoreJourney': {
      const [next, planner] = newPlanner(state, action.destination, { ...action.origin, ready: true }, 'idle');
      return { ...next, root: { kind: 'saved' }, details: [planner], settings: false, travel: action.travel };
    }
    case 'replan': {
      const current = plannerTask(state);
      const selected = selectedPlace(state);
      const keep = !action.destination || (selected && sameCoordinate(selected.coordinate, action.destination.coordinate));
      const destination = keep ? selected : action.destination;
      // Without any destination no planner opens, so nothing else changes either.
      if (!destination) return state;
      const origin: PlannerOrigin = action.from
        ? { coordinate: action.from, label: ORIGIN_LABELS.replan, ready: true }
        : { coordinate: current?.origin.coordinate ?? action.viewport, label: current?.origin.label ?? ORIGIN_LABELS.unset, ready: false };
      const [next, planner] = newPlanner(state, destination, origin, action.from ? 'idle' : 'picking');
      const placeBelow = keep ? state.details.filter(task => task.kind === 'place') : [];
      return { ...next, details: [...placeBelow, planner], settings: false, travel: { mode: 'transit', transitTime: { kind: 'now' } } };
    }
    case 'locateOrigin': {
      const index = state.details.findIndex(task => task.kind === 'planner');
      if (index < 0) return state;
      const trimmed = { ...state, details: state.details.slice(0, index + 1) };
      return updatePlanner(trimmed, planner => ({ ...planner, origin: { ...planner.origin, ready: false }, originStep: 'locating' }));
    }
    case 'originLocated':
      return updatePlanner(state, planner => planner.originStep !== 'locating' ? planner
        : { ...planner, origin: { coordinate: action.coordinate, label: ORIGIN_LABELS.device, ready: true }, originStep: 'idle' });
    case 'originLocateFailed':
      return updatePlanner(state, planner => planner.originStep === 'locating' ? { ...planner, originStep: 'picking' } : planner);
    case 'locationRequestCancelled':
      return updatePlanner(state, planner => planner.originStep === 'locating' ? { ...planner, originStep: 'idle' } : planner);
    case 'pickOrigin':
      return updatePlanner(state, planner => planner.originStep === 'picking' ? planner : { ...planner, originStep: 'picking' });
    case 'setOrigin':
      return updatePlanner(state, planner => planner.originStep !== 'picking' ? planner
        : { ...planner, origin: { coordinate: action.coordinate, label: ORIGIN_LABELS.map, ready: true }, originStep: 'idle' });
    case 'cancelOriginPicking':
      return updatePlanner(state, planner => planner.originStep === 'picking' ? cancelPicking(planner) : planner);
    case 'setTravelMode':
      return state.travel.mode === action.mode ? state : { ...state, travel: { ...state.travel, mode: action.mode } };
    case 'setTransitTime':
      return { ...state, travel: { ...state.travel, transitTime: action.transitTime } };
    case 'openJourneyStop':
      return last(state.details)?.kind === 'planner' && !state.settings
        ? { ...state, details: [...state.details, { kind: 'journeyStop', stop: action.stop }] } : state;
    case 'toggleSettings':
      return { ...state, settings: !state.settings };
    case 'closeDetails':
      return details(state, []);
    case 'closeTopTask':
      return closeTop(state);
    case 'back': {
      const top = topTask(state);
      if (top.kind === 'planner' && top.originStep === 'picking') return updatePlanner(state, cancelPicking);
      return closeTop(state);
    }
  }
}

export function topTask(state: TaskState): Task {
  return state.settings ? settingsTask : last(state.details) ?? state.root;
}
export function plannerTask(state: TaskState): PlannerTask | null {
  return state.details.find((task): task is PlannerTask => task.kind === 'planner') ?? null;
}
/** The place shown on the map as the current destination or detail. */
export function selectedPlace(state: TaskState): Place | null {
  const planner = plannerTask(state);
  if (planner) return planner.destination;
  const place = state.details.find((task): task is PlaceTask => task.kind === 'place');
  return place?.place ?? null;
}
export function journeyStop(state: TaskState): Stop | null {
  const task = state.details.find((item): item is JourneyStopTask => item.kind === 'journeyStop');
  return task?.stop ?? null;
}
/** The stop whose board is open, whether from Trasporti, Salvati or a journey. */
export function boardStop(state: TaskState): Stop | null {
  const task = last(state.details);
  return task?.kind === 'stop' || task?.kind === 'journeyStop' ? task.stop : null;
}
export function selectedStop(state: TaskState): Stop | null {
  const task = state.details.find((item): item is StopTask => item.kind === 'stop');
  return task?.stop ?? null;
}
/** True when the planner is in front and has no outstanding origin step. */
export function plannerInFront(state: TaskState): boolean {
  const top = topTask(state);
  return top.kind === 'planner' && top.originStep === 'idle';
}
/** True when a stop board is in front of every other task. */
export function boardInFront(state: TaskState): boolean {
  const kind = topTask(state).kind;
  return kind === 'stop' || kind === 'journeyStop';
}
export function searchRoot(state: TaskState): Extract<RootTask, { kind: 'search' }> | null {
  return state.root.kind === 'search' ? state.root : null;
}
export function hasTaskAboveRoot(state: TaskState): boolean {
  return state.settings || state.details.length > 0;
}
export function sheetVisible(state: TaskState): boolean {
  return hasTaskAboveRoot(state) || state.root.kind !== 'browse';
}
/** Identifies sheet content; a change scrolls the sheet to the top and collapses it. */
export function detailKey(state: TaskState): string {
  const top = topTask(state);
  switch (top.kind) {
    case 'settings': return 'privacy';
    case 'journeyStop': return `journey-stop:${top.stop.id}`;
    case 'planner': return `route:${top.destination.id}`;
    case 'stop': return `stop:${top.stop.id}`;
    case 'place': return `place:${top.place.id}`;
    case 'transit': case 'saved': return `list:${top.kind}`;
    case 'browse': case 'search': return 'list:explore';
  }
}
export function rootTab(state: TaskState): 'explore' | 'transit' | 'saved' {
  return state.root.kind === 'transit' || state.root.kind === 'saved' ? state.root.kind : 'explore';
}

/** Structural invariant of `details`, used by tests and development assertions. */
export function isValidTaskState(state: TaskState): boolean {
  const kinds = state.details.map(task => task.kind).join(',');
  return ['', 'place', 'stop', 'planner', 'place,planner', 'planner,journeyStop', 'place,planner,journeyStop'].includes(kinds);
}
