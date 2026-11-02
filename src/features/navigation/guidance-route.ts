import type { GuidanceManeuver, RouteProgress } from '../../domain/navigation';
import { framesManeuver, type CameraMode } from './guidance-camera';
import { bearingDegrees, offsetOfIndex, sliceRoute, type RouteMeasure } from './route-measure';

/**
 * Fraction of the rendered route already travelled. The native offset is measured with the same
 * haversine metric on the same geometry; MapLibre's `line-progress` uses projected length, which
 * differs by well under 0.1% across a city.
 */
export function traveledFraction(route: RouteMeasure | null, progress: RouteProgress | undefined): number {
  if (!route || route.length <= 0 || !progress || !Number.isFinite(progress.traveledMeters)) return 0;
  return Math.min(1, Math.max(0, progress.traveledMeters / route.length));
}

/** `line-gradient` hiding the travelled part of the active route (a muted full route shows beneath). */
export function remainingGradient(color: string, fraction: number): unknown[] {
  const cut = Math.min(0.999998, Math.max(0, fraction));
  if (cut <= 0) return ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color];
  return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', cut, 'rgba(0,0,0,0)', cut + 0.000001, color, 1, color];
}

const ARROW: Record<CameraMode, { before: number; after: number }> = {
  walk: { before: 12, after: 10 }, bicycle: { before: 20, after: 16 }, car: { before: 35, after: 26 },
};
export interface ManeuverArrow {
  /** Shaft through the junction: incoming geometry, the maneuver point, outgoing geometry. */
  shaft: [number, number][];
  /** Arrowhead at the shaft end, rotated to the last outgoing segment. */
  head: { coordinate: [number, number]; bearing: number };
}

/**
 * One cased arrow through the upcoming junction, from the real incoming/outgoing route geometry.
 * Never drawn behind the current progress, for arrival/departure or a straight continuation.
 */
export function maneuverArrow(route: RouteMeasure | null, maneuver: GuidanceManeuver | undefined, mode: CameraMode, traveled: number): ManeuverArrow | null {
  if (!route || !maneuver || !framesManeuver(maneuver)) return null;
  const at = offsetOfIndex(route, maneuver.geometryIndex);
  const { before, after } = ARROW[mode];
  const start = Math.max(traveled, at - before);
  const end = Math.min(route.length, at + after);
  if (end - start < 4 || end <= at) return null;
  const points = sliceRoute(route, start, end);
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const previous = sliceRoute(route, Math.max(at, end - 4), end)[0]!;
  return {
    shaft: points.map(point => [point.longitude, point.latitude]),
    head: { coordinate: [last.longitude, last.latitude], bearing: bearingDegrees(previous, last) },
  };
}
