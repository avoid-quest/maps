import type { Coordinate } from '../../domain/types';
import type { FollowingManeuver, GuidanceManeuver, NavigationFix } from '../../domain/navigation';
import { bearingDegrees, measureRoute, offsetCoordinate, offsetOfIndex, pointAt, type RouteMeasure } from './route-measure';
import type { CameraInput, CameraMode, GuidanceViewport } from './guidance-camera';

/**
 * Deterministic route fixtures for camera and banner tests: a polyline built from (bearing, metres)
 * legs in 5 m points, with one maneuver at each leg start, and a 1 Hz trajectory generator.
 */
export const TURIN: Coordinate = { latitude: 45.0703, longitude: 7.6869 };
export const PHONE: GuidanceViewport = { width: 412, height: 860, top: 150, bottom: 780, left: 0, right: 412 };
/** Landscape: banner over the left part, a 320 dp side panel on the right, no bottom strip. */
export const LANDSCAPE: GuidanceViewport = { width: 915, height: 380, top: 120, bottom: 380, left: 0, right: 595 };

/** A fixture maneuver's point (fixtures always carry coordinates). */
export const maneuverPoint = (m: GuidanceManeuver): Coordinate => ({ latitude: m.latitude!, longitude: m.longitude! });

export interface FixtureLeg { bearing: number; meters: number; type?: string; modifier?: GuidanceManeuver['modifier']; exit?: number }
export interface RouteFixture { route: RouteMeasure; maneuvers: GuidanceManeuver[] }

export function routeFixture(legs: FixtureLeg[], revision = 1): RouteFixture {
  const points: Coordinate[] = [TURIN];
  const starts: number[] = [];
  for (const leg of legs) {
    starts.push(points.length - 1);
    const count = Math.max(1, Math.round(leg.meters / 5));
    for (let i = 0; i < count; i += 1) points.push(offsetCoordinate(points[points.length - 1]!, leg.bearing, leg.meters / count));
  }
  const route = measureRoute(points);
  const maneuvers: GuidanceManeuver[] = legs.map((leg, k) => ({
    id: `${revision}:${k}`, stepIndex: k, geometryIndex: starts[k]!, type: k === 0 ? 'depart' : leg.type ?? 'turn',
    ...(leg.modifier ? { modifier: leg.modifier } : {}), ...(leg.exit ? { exit: leg.exit } : {}),
    instruction: `Passo ${k}`, ...pointAt(route, offsetOfIndex(route, starts[k]!)),
  }));
  maneuvers.push({ id: `${revision}:${legs.length}`, stepIndex: legs.length, geometryIndex: points.length - 1, type: 'arrive', instruction: 'Arrivo', ...points[points.length - 1]! });
  return { route, maneuvers };
}

/** Upcoming/following maneuvers and distance at a route offset, like the native snapshot. */
export function guidanceAt(fixture: RouteFixture, traveled: number, speed: number) {
  const offsets = fixture.maneuvers.map(m => offsetOfIndex(fixture.route, m.geometryIndex));
  // Ferrostar advances once the maneuver point is passed.
  const upcomingIndex = offsets.findIndex((offset, k) => k > 0 && offset > traveled + 0.5);
  const index = upcomingIndex < 0 ? fixture.maneuvers.length - 1 : upcomingIndex;
  const upcoming = fixture.maneuvers[index];
  const next = fixture.maneuvers[index + 1];
  const following: FollowingManeuver | undefined = next ? {
    ...next, afterUpcomingMeters: offsets[index + 1]! - offsets[index]!, afterUpcomingSeconds: (offsets[index + 1]! - offsets[index]!) / Math.max(0.5, speed),
  } : undefined;
  return { upcoming, following, distanceToManeuverMeters: Math.max(0, offsets[index]! - traveled) };
}

export interface TrajectoryOptions {
  mode: CameraMode; speed: number; seconds: number; startOffset?: number; lateralMeters?: number;
  accuracy?: number; course?: (t: number, routeBearing: number) => number | undefined; speedAt?: (t: number) => number;
  alignment?: CameraInput['alignment']; usable?: (t: number) => boolean; viewport?: GuidanceViewport;
}

/** 1 Hz camera inputs along a fixture route. */
export function trajectory(fixture: RouteFixture, options: TrajectoryOptions): CameraInput[] {
  const inputs: CameraInput[] = [];
  let traveled = options.startOffset ?? 0;
  for (let t = 0; t < options.seconds; t += 1) {
    const speed = options.speedAt ? options.speedAt(t) : options.speed;
    const position = pointAt(fixture.route, traveled);
    const ahead = pointAt(fixture.route, Math.min(fixture.route.length, traveled + 3));
    const routeBearing = bearingDegrees(position, ahead);
    const raw = options.lateralMeters ? offsetCoordinate(position, routeBearing + 90, options.lateralMeters) : position;
    const course = options.course ? options.course(t, routeBearing) : speed >= 1 ? routeBearing : undefined;
    const fix: NavigationFix = {
      ...raw, accuracyMeters: options.accuracy ?? 5, timestamp: 1_800_000_000_000 + t * 1000, elapsedMs: 10_000 + t * 1000, speedMps: speed,
      ...(course !== undefined ? { course: (course + 360) % 360, courseAccuracyDegrees: 8 } : {}),
    };
    inputs.push({
      mode: options.mode, fix, usable: options.usable ? options.usable(t) : true, route: fixture.route, routeRevision: 1,
      progress: { traveledMeters: traveled, routeLengthMeters: fixture.route.length, segmentIndex: 0, stepIndex: 0 },
      alignment: options.alignment ?? 'aligned', snapped: position, viewport: options.viewport ?? PHONE,
      ...guidanceAt(fixture, traveled, speed),
    });
    traveled = Math.min(fixture.route.length, traveled + speed);
  }
  return inputs;
}
