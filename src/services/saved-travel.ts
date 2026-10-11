import staticStops from '../data/gtt-stops.json';
import manifest from '../data/manifest.json';
import type { Coordinate, RouteLeg, RoutePlan, RouteStep, RouteStop, Stop, TransitTime, TravelMode } from '../domain/types';
import { resolveTransitTime } from './transit-time';

export const JOURNEY_STORAGE_KEY = '@avoid-maps/saved-journey-v1';
export const STOPS_STORAGE_KEY = '@avoid-maps/saved-stops-v1';
export const MAX_JOURNEY_BYTES = 512 * 1024;
export const MAX_STOPS_BYTES = 64 * 1024;
export const MAX_SAVED_STOPS = 100;

export interface SavedJourneyInput {
  query: { from: Coordinate; to: Coordinate; mode: TravelMode; transitTime: TransitTime };
  originLabel: string;
  destinationLabel: string;
  plan: RoutePlan;
}
export interface SavedJourney extends SavedJourneyInput { savedAt: number }
export interface SavedStop {
  id: string; code: string; name: string; coordinate: Coordinate; datasetVersion: string;
}
export interface SavedStopEntry { saved: SavedStop; current: Stop | null }
export type SavedTravelFailure = 'invalid-data' | 'too-large' | 'storage-unavailable' | 'stop-unavailable' | 'limit-reached' | 'not-ready';
type LoadStatus = 'loading' | 'ready' | 'unavailable';
export interface SavedTravelSnapshot {
  journey: SavedJourney | null;
  stops: readonly SavedStopEntry[];
  journeyStatus: LoadStatus;
  stopsStatus: LoadStatus;
  journeyFailure: SavedTravelFailure | null;
  stopsFailure: SavedTravelFailure | null;
}
export interface SavedTravelStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
interface StoreOptions {
  now?: () => number;
  getStop?: (id: string) => Stop | undefined;
  datasetVersion?: string;
}

class InvalidSavedTravel extends Error {
  constructor(readonly reason: SavedTravelFailure = 'invalid-data') { super(reason); }
}
function invalid(reason: SavedTravelFailure = 'invalid-data'): never { throw new InvalidSavedTravel(reason); }
function reason(error: unknown): SavedTravelFailure {
  return error instanceof InvalidSavedTravel ? error.reason : 'invalid-data';
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function list(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum) invalid();
  if (value.length > maximum) invalid('too-large');
  return value;
}
function finite(value: unknown, maximum: number, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}
function timestamp(value: unknown): number {
  const at = finite(value, 4102444800000, 946684800000);
  if (!Number.isInteger(at)) invalid();
  return at;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid();
  return value as T;
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  if (value.length > maximum) invalid('too-large');
  return value;
}
function coordinate(value: unknown): Coordinate {
  const point = record(value);
  return { latitude: finite(point.latitude, 90, -90), longitude: finite(point.longitude, 180, -180) };
}
function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

/** No TextEncoder dependency: Hermes and the browser use the same UTF-8 storage bound. */
function withinBytes(value: string, maximum: number): void {
  if (value.length > maximum) invalid('too-large');
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > maximum) invalid('too-large');
  }
}
function decode(raw: string, maximum: number): Record<string, unknown> {
  withinBytes(raw, maximum);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { invalid(); }
  const envelope = record(value);
  if (envelope.version !== 1) invalid();
  return envelope;
}
function encode(value: unknown, maximum: number): string {
  const serialized = JSON.stringify(value);
  withinBytes(serialized, maximum);
  return serialized;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function transitTime(value: unknown): TransitTime {
  const time = record(value);
  const kind = choice(time.kind, ['now', 'depart-at', 'arrive-by']);
  if (kind === 'now') return { kind };
  const selected = { kind, date: text(time.date, 10), time: text(time.time, 8) };
  try { resolveTransitTime(selected); } catch { invalid(); }
  return selected;
}

/** Rebuild every nested object. Unknown fields never enter the saved record or UI. */
function journeyInput(value: unknown): SavedJourneyInput {
  const input = record(value); const query = record(input.query);
  let remainingPoints = 20_000; let remainingSteps = 2_000; let remainingText = MAX_JOURNEY_BYTES;
  function string(value: unknown, maximum = 512): string {
    const clean = text(value, maximum);
    remainingText -= clean.length;
    if (remainingText < 0) invalid('too-large');
    return clean;
  }
  function point(value: unknown): Coordinate {
    if (--remainingPoints < 0) invalid('too-large');
    return coordinate(value);
  }
  const geometry = (value: unknown) => list(value, 20_000).map(point);
  function stop(value: unknown): RouteStop {
    const item = record(value);
    return {
      id: string(item.id, 4096), name: string(item.name),
      code: optional(item.code, value => string(value, 128)),
      platformCode: optional(item.platformCode, value => string(value, 128)),
      coordinate: optional(item.coordinate, point),
    };
  }
  function step(value: unknown): RouteStep {
    if (--remainingSteps < 0) invalid('too-large');
    const item = record(value);
    return { instruction: string(item.instruction, 2048), distanceMeters: finite(item.distanceMeters, 50_000_000), coordinate: optional(item.coordinate, point) };
  }
  function leg(value: unknown): RouteLeg {
    const item = record(value);
    const result: RouteLeg = {
      id: string(item.id, MAX_JOURNEY_BYTES / 2), mode: string(item.mode, 64),
      line: optional(item.line, value => string(value, 128)), headsign: optional(item.headsign, string),
      from: string(item.from), to: string(item.to), fromStop: optional(item.fromStop, stop), toStop: optional(item.toStop, stop),
      tripId: optional(item.tripId, value => string(value, 1024)), serviceDate: optional(item.serviceDate, value => string(value, 8)),
      transitLeg: bool(item.transitLeg), interlineWithPreviousLeg: bool(item.interlineWithPreviousLeg),
      timingStatus: choice(item.timingStatus, ['scheduled', 'prediction', 'cancelled', 'unknown']), realTime: bool(item.realTime),
      durationSeconds: finite(item.durationSeconds, 31 * 86400), distanceMeters: finite(item.distanceMeters, 50_000_000),
      departureAt: optional(item.departureAt, timestamp), arrivalAt: optional(item.arrivalAt, timestamp),
      geometry: geometry(item.geometry), steps: list(item.steps, 2_000).map(step),
    };
    if (result.serviceDate) {
      const date = result.serviceDate;
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      const parsed = new Date(`${iso}T12:00:00Z`);
      if (!/^\d{8}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) invalid();
    }
    if (result.realTime !== (result.timingStatus === 'prediction') || (!result.transitLeg && result.timingStatus !== 'unknown')) invalid();
    return result;
  }
  const item = record(input.plan);
  const plan: RoutePlan = {
    id: string(item.id, MAX_JOURNEY_BYTES / 2), mode: choice(item.mode, ['walk', 'bicycle', 'car', 'transit']),
    distanceMeters: finite(item.distanceMeters, 50_000_000), durationSeconds: finite(item.durationSeconds, 31 * 86400),
    departureAt: optional(item.departureAt, timestamp), arrivalAt: optional(item.arrivalAt, timestamp),
    walkingDurationSeconds: finite(item.walkingDurationSeconds, 31 * 86400), walkingDistanceMeters: finite(item.walkingDistanceMeters, 50_000_000),
    waitingDurationSeconds: finite(item.waitingDurationSeconds, 31 * 86400), transferCount: finite(item.transferCount, 99),
    geometry: geometry(item.geometry), legs: list(item.legs, 100, 1).map(leg),
    source: string(item.source), warnings: list(item.warnings, 32).map(value => string(value, 2048)), fetchedAt: timestamp(item.fetchedAt),
  };
  const mode = choice(query.mode, ['walk', 'bicycle', 'car', 'transit']);
  if (mode !== plan.mode || !Number.isInteger(plan.transferCount) || plan.walkingDurationSeconds > plan.durationSeconds + 1
    || plan.walkingDistanceMeters > plan.distanceMeters + 1 || plan.waitingDurationSeconds > plan.durationSeconds + 1) invalid();
  if (new Set(plan.legs.map(item => item.id)).size !== plan.legs.length) invalid();
  for (const [index, item] of plan.legs.entries()) {
    const previous = plan.legs[index - 1];
    if (item.interlineWithPreviousLeg && (!item.transitLeg || !previous?.transitLeg)) invalid();
    validateTimes(item, mode === 'transit');
    if (item.departureAt !== undefined && previous?.arrivalAt !== undefined && item.departureAt < previous.arrivalAt) invalid();
  }
  validateTimes(plan, mode === 'transit');
  if (plan.departureAt !== undefined && plan.legs[0]!.departureAt !== undefined && plan.departureAt > plan.legs[0]!.departureAt!) invalid();
  if (plan.arrivalAt !== undefined && plan.legs.at(-1)!.arrivalAt !== undefined && plan.arrivalAt < plan.legs.at(-1)!.arrivalAt!) invalid();
  const transfers = Math.max(0, plan.legs.filter(item => item.transitLeg && !item.interlineWithPreviousLeg).length - 1);
  if (plan.transferCount !== transfers) invalid();
  return {
    query: { from: point(query.from), to: point(query.to), mode, transitTime: transitTime(query.transitTime) },
    originLabel: string(input.originLabel), destinationLabel: string(input.destinationLabel), plan,
  };
}
function validateTimes(value: { departureAt?: number; arrivalAt?: number; durationSeconds: number }, required: boolean): void {
  const { departureAt, arrivalAt } = value;
  if (departureAt === undefined && arrivalAt === undefined && !required) return;
  if (departureAt === undefined || arrivalAt === undefined || arrivalAt < departureAt
    || Math.abs((arrivalAt - departureAt) / 1000 - value.durationSeconds) > 1) invalid();
}
function savedJourney(value: unknown): SavedJourney {
  return { ...journeyInput(value), savedAt: timestamp(record(value).savedAt) };
}
function savedStop(value: unknown): SavedStop {
  const item = record(value);
  return {
    id: text(item.id, 128), code: text(item.code, 128), name: text(item.name),
    coordinate: coordinate(item.coordinate), datasetVersion: text(item.datasetVersion, 128),
  };
}
function stopList(raw: string): SavedStop[] {
  const values = list(decode(raw, MAX_STOPS_BYTES).stops, MAX_SAVED_STOPS).map(savedStop);
  if (new Set(values.map(item => item.id)).size !== values.length) invalid();
  return values;
}

interface SlotState<T> { value: T; status: LoadStatus; failure: SavedTravelFailure | null }

/** Each key owns its committed value and write queue; failed writes never publish a proposed value. */
function createSlot<T>(key: string, empty: T, parse: (raw: string) => T, serialize: (value: T) => string, notify: () => void) {
  let value = freeze(empty); let readStatus: LoadStatus = 'loading'; let readFailure: SavedTravelFailure | null = null;
  let mutationFailure: SavedTravelFailure | null = null;
  let storage: SavedTravelStorage | undefined; let initialization: Promise<void> | undefined;
  let committedMutation = false; let requested = 0; let settled = 0;
  let writes: Promise<unknown> = Promise.resolve();
  const committedState = (): SlotState<T> => ({
    value, status: committedMutation ? 'ready' : readStatus,
    failure: mutationFailure ?? readFailure,
  });
  // A notification from the other key must not expose an obsolete read/write
  // while this key still has a newer replacement or removal pending.
  let visible = committedState();
  function publish() { visible = committedState(); notify(); }
  return {
    state: () => visible,
    initialize(target: SavedTravelStorage): Promise<void> {
      if (initialization) return initialization;
      storage = target;
      initialization = (async () => {
        let loaded = empty; let failure: SavedTravelFailure | null = null;
        try {
          let raw: string | null;
          try { raw = await target.getItem(key); } catch { invalid('storage-unavailable'); }
          loaded = raw === null ? empty : parse(raw);
        } catch (error) { failure = reason(error); }
        // Even a read begun before removeItem can complete with the old bytes.
        if (!committedMutation) { value = freeze(loaded); readStatus = failure ? 'unavailable' : 'ready'; readFailure = failure; }
        if (mutationFailure === 'not-ready') mutationFailure = null;
        if (requested === settled) publish();
      })();
      return initialization;
    },
    mutate(change: (previous: T) => T, remove = false, requireLoaded = false): Promise<boolean> {
      if (!storage) { mutationFailure = 'not-ready'; publish(); return Promise.resolve(false); }
      const target = storage; const operation = ++requested;
      const task = writes.then(async () => {
        try {
          if (requireLoaded && committedState().status !== 'ready') invalid(committedState().failure ?? 'not-ready');
          const next = freeze(change(value));
          const serialized = remove ? undefined : serialize(next);
          try {
            if (remove) await target.removeItem(key);
            else await target.setItem(key, serialized!);
          } catch { invalid('storage-unavailable'); }
          value = next; committedMutation = true; readFailure = null; mutationFailure = null;
          return true;
        } catch (error) { mutationFailure = reason(error); return false; }
        finally { settled = operation; if (operation === requested) publish(); }
      });
      writes = task;
      return task;
    },
  };
}

const installedStops = new Map<string, Stop>((staticStops as Stop[]).map(stop => [stop.id, stop]));

export function createSavedTravel(options: StoreOptions = {}) {
  const now = options.now ?? Date.now;
  const getStop = options.getStop ?? (id => installedStops.get(id));
  const datasetVersion = options.datasetVersion ?? manifest.gtt.version;
  const listeners = new Set<() => void>();
  let snapshot: SavedTravelSnapshot = Object.freeze({
    journey: null, stops: Object.freeze([]), journeyStatus: 'loading', stopsStatus: 'loading', journeyFailure: null, stopsFailure: null,
  });
  function currentStop(saved: SavedStop): Stop | null {
    const current = getStop(saved.id);
    if (!current || current.id !== saved.id || current.code !== saved.code
      || current.coordinate.latitude !== saved.coordinate.latitude || current.coordinate.longitude !== saved.coordinate.longitude) return null;
    return { id: current.id, code: current.code, name: text(current.name), coordinate: coordinate(current.coordinate), lines: list(current.lines, 256).map(value => text(value, 128)) };
  }
  function notify() {
    const journey = journeys.state(); const savedStops = stops.state();
    snapshot = freeze({
      journey: journey.value, journeyStatus: journey.status, journeyFailure: journey.failure,
      stops: savedStops.value.map(saved => {
        let current: Stop | null = null;
        try { current = currentStop(saved); } catch { /* A missing or unusable installed record cannot open a board. */ }
        return { saved, current };
      }),
      stopsStatus: savedStops.status, stopsFailure: savedStops.failure,
    });
    for (const listener of listeners) { try { listener(); } catch { /* Observers must not interrupt storage operations. */ } }
  }
  const journeys = createSlot<SavedJourney | null>(JOURNEY_STORAGE_KEY, null,
    raw => savedJourney(decode(raw, MAX_JOURNEY_BYTES).journey),
    value => encode({ version: 1, journey: value }, MAX_JOURNEY_BYTES), notify);
  const stops = createSlot<SavedStop[]>(STOPS_STORAGE_KEY, [], stopList,
    value => encode({ version: 1, stops: value }, MAX_STOPS_BYTES), notify);
  let initialization: Promise<void> | undefined;
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize(storage: SavedTravelStorage): Promise<void> {
      initialization ??= Promise.all([journeys.initialize(storage), stops.initialize(storage)]).then(() => undefined);
      return initialization;
    },
    saveJourney(input: SavedJourneyInput): Promise<boolean> {
      // Capture the selected plan now: later UI edits cannot change an already queued save.
      let next: SavedJourney; let failure: SavedTravelFailure | undefined;
      try { next = { ...journeyInput(input), savedAt: timestamp(now()) }; } catch (error) { failure = reason(error); }
      return journeys.mutate(() => { if (failure) invalid(failure); return next!; });
    },
    clearJourney: () => journeys.mutate(() => null, true),
    saveStop(id: string): Promise<boolean> {
      let next: SavedStop; let failure: SavedTravelFailure | undefined;
      try {
        text(id, 128);
        const current = getStop(id);
        if (!current || current.id !== id) invalid('stop-unavailable');
        next = savedStop({ ...current, datasetVersion });
      } catch (error) { failure = reason(error); }
      return stops.mutate(previous => {
        if (failure) invalid(failure);
        const others = previous.filter(item => item.id !== next!.id);
        if (others.length >= MAX_SAVED_STOPS) invalid('limit-reached');
        return [next!, ...others];
      }, false, true);
    },
    removeStop: (id: string) => stops.mutate(previous => {
      text(id, 128);
      return previous.filter(item => item.id !== id);
    }, false, true),
    clearStops: () => stops.mutate(() => [], true),
  };
}

export const savedTravel = createSavedTravel();
