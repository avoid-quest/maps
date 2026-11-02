import type { NavigationStart, TransitNavigationStart } from './navigation';
import type { Coordinate, RouteLeg, RoutePlan, RouteStop } from './types';

/**
 * Payloads handed to the Android navigation module.
 *
 * Expo Modules converts a JavaScript object argument typed `Map<String, Any?>` with its `Any`
 * converter: every nested value must be a boolean, number, string, array or object. A nested
 * `undefined` or `null` is not handled there (the converter calls `asObject` on it) and the call is
 * rejected with ERR_UNEXPECTED before the Kotlin function body runs. The native checkpoint also
 * stores the plan as JSON, which rejects NaN and infinities. So the payloads are built explicitly
 * from the fields the native code reads, omitting absent optional fields instead of sending them.
 */
export type BridgeValue = string | number | boolean | BridgeValue[] | { [key: string]: BridgeValue };

/** Where a value is not bridge-safe, or null when it is. */
export function bridgeSafetyProblem(value: unknown, path = 'payload', depth = 0): string | null {
  if (depth > 12) return `${path}: too deep`;
  if (typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path}: non-finite number`;
  if (value === undefined) return `${path}: undefined`;
  if (value === null) return `${path}: null`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) return `${path}[${index}]: hole`;
      const problem = bridgeSafetyProblem(value[index], `${path}[${index}]`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return `${path}: ${prototype?.constructor?.name ?? 'class'} instance`;
    for (const [key, item] of Object.entries(value)) {
      const problem = bridgeSafetyProblem(item, `${path}.${key}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  return `${path}: ${typeof value}`;
}

/** A coordinate with only its two numbers, whatever else the source object carries. */
export const bridgePoint = ({ latitude, longitude }: Coordinate) => ({ latitude, longitude });
const point = bridgePoint;
function stop(value: RouteStop | undefined): { coordinate: { latitude: number; longitude: number } } | undefined {
  // TransitJourneyEngine reads only the stop coordinate (for advisory proximity).
  return value?.coordinate ? { coordinate: point(value.coordinate) } : undefined;
}
function defined<T extends Record<string, unknown>>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** One leg as TransitJourneyEngine reads it. */
function nativeLeg(leg: RouteLeg) {
  return defined({
    mode: leg.mode, transitLeg: leg.transitLeg, interlineWithPreviousLeg: leg.interlineWithPreviousLeg, timingStatus: leg.timingStatus,
    line: leg.line, headsign: leg.headsign, from: leg.from, to: leg.to,
    fromStop: stop(leg.fromStop), toStop: stop(leg.toStop),
    distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, departureAt: leg.departureAt, arrivalAt: leg.arrivalAt,
    geometry: leg.geometry.map(point),
  });
}

/** The plan as the native session reads and checkpoints it: mode, retrieval time, source, overview geometry and legs. */
export function nativeTransitPlan(plan: RoutePlan) {
  return { mode: plan.mode, fetchedAt: plan.fetchedAt, source: plan.source, geometry: plan.geometry.map(point), legs: plan.legs.map(nativeLeg) };
}

export class BridgePayloadError extends Error {
  readonly code = 'invalid';
  constructor(readonly problem: string) { super('invalid'); this.name = 'BridgePayloadError'; }
}
function checked<T>(payload: T): T {
  const problem = bridgeSafetyProblem(payload);
  if (problem) throw new BridgePayloadError(problem);
  return payload;
}

export function nativeTransitStart(options: TransitNavigationStart) {
  return checked({ plan: nativeTransitPlan(options.plan), origin: point(options.origin), destination: point(options.destination) });
}
export function nativeRoadStart(options: NavigationStart) {
  return checked({ destination: point(options.destination), mode: options.mode });
}
