import type { Coordinate } from '../../domain/types';

/** Mean Earth radius used by the native haversine (NavigationGeometry), so offsets agree. */
const EARTH_RADIUS = 6_371_000;
const rad = (degrees: number) => degrees * Math.PI / 180;
const deg = (radians: number) => radians * 180 / Math.PI;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Initial compass bearing from a to b in [0, 360). */
export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const phi1 = rad(a.latitude); const phi2 = rad(b.latitude); const dLambda = rad(b.longitude - a.longitude);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached from `from` after `meters` along compass `bearing` (local flat approximation). */
export function offsetCoordinate(from: Coordinate, bearing: number, meters: number): Coordinate {
  const b = rad(bearing);
  return {
    latitude: from.latitude + (meters * Math.cos(b)) / (EARTH_RADIUS * Math.PI / 180),
    longitude: from.longitude + (meters * Math.sin(b)) / (EARTH_RADIUS * Math.PI / 180 * Math.cos(rad(from.latitude))),
  };
}

/** Signed shortest angular difference `to - from` in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  const d = ((to - from) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}
export const normalizeBearing = (value: number) => ((value % 360) + 360) % 360;

/**
 * Immutable measure over one route revision's geometry: cumulative haversine distance (the metric
 * the native progress offset uses), interpolation and slices by route offset.
 */
export interface RouteMeasure {
  readonly points: readonly Coordinate[];
  readonly cumulative: Float64Array;
  readonly length: number;
}

export function measureRoute(points: readonly Coordinate[]): RouteMeasure {
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i += 1) cumulative[i] = cumulative[i - 1]! + distanceMeters(points[i - 1]!, points[i]!);
  return { points, cumulative, length: points.length ? cumulative[points.length - 1]! : 0 };
}

/** Index i such that cumulative[i] <= offset < cumulative[i + 1] (clamped to the last segment). */
export function segmentAt(route: RouteMeasure, offset: number): number {
  const { cumulative, points } = route;
  if (points.length < 2) return 0;
  let lo = 0; let hi = points.length - 1;
  if (offset <= 0) return 0;
  if (offset >= route.length) return points.length - 2;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= offset) lo = mid; else hi = mid;
  }
  return lo;
}

export function pointAt(route: RouteMeasure, offset: number): Coordinate {
  const { points, cumulative } = route;
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  if (points.length === 1) return points[0]!;
  const clamped = Math.min(route.length, Math.max(0, offset));
  const i = segmentAt(route, clamped);
  const a = points[i]!; const b = points[i + 1]!;
  const span = cumulative[i + 1]! - cumulative[i]!;
  const t = span > 0 ? (clamped - cumulative[i]!) / span : 0;
  return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
}

/** Points of the route between two offsets, both ends interpolated. */
export function sliceRoute(route: RouteMeasure, from: number, to: number): Coordinate[] {
  if (route.points.length < 2) return [...route.points];
  const start = Math.max(0, Math.min(from, to)); const end = Math.min(route.length, Math.max(from, to));
  const result = [pointAt(route, start)];
  for (let i = segmentAt(route, start) + 1; i < route.points.length && route.cumulative[i]! < end; i += 1) result.push(route.points[i]!);
  result.push(pointAt(route, end));
  return result;
}

/**
 * Bearing of the route ahead of `offset`: from the point at `offset` to the point `lookAhead` metres
 * further, never beyond `limit` (the next maneuver), so the camera does not rotate before a turn.
 */
export function routeBearingAt(route: RouteMeasure, offset: number, lookAhead: number, limit = Infinity): number | null {
  if (route.points.length < 2) return null;
  const end = Math.min(route.length, offset + lookAhead, Math.max(offset + 2, limit));
  const start = Math.max(0, Math.min(offset, end - 2));
  const a = pointAt(route, start); const b = pointAt(route, end);
  return distanceMeters(a, b) < 0.5 ? null : bearingDegrees(a, b);
}

/** Route offset of a geometry index. */
export const offsetOfIndex = (route: RouteMeasure, index: number) => route.cumulative[Math.max(0, Math.min(route.points.length - 1, Math.round(index)))] ?? 0;
