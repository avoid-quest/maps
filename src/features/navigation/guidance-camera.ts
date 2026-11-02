import type { Coordinate } from '../../domain/types';
import type { FollowingManeuver, GuidanceManeuver, NavigationFix, RouteProgress } from '../../domain/navigation';
import { inside, paddingForAnchor, project, type CameraPose, type Padding, type ScreenPoint, type VisibleRect } from './map-projection';
import { angleDelta, bearingDegrees, distanceMeters, normalizeBearing, offsetCoordinate, offsetOfIndex, pointAt, routeBearingAt, sliceRoute, type RouteMeasure } from './route-measure';

export type CameraMode = 'walk' | 'bicycle' | 'car';

/**
 * Per-mode first-person camera. Values are starting points tuned by replay; see
 * docs/development/navigation.md. Zoom is MapLibre zoom (512 px tiles), pitch in degrees, anchor
 * is the puck's position as a fraction of the unobscured map height (between banner and strip).
 */
export interface CameraProfile {
  pitch: number;
  /** Cruise zoom for a smoothed speed (m/s). */
  cruiseZoom: (speed: number) => number;
  /** Lowest zoom turn framing may reach. */
  minZoom: number;
  anchor: number;
  /** Turn framing starts this many seconds before the maneuver. */
  anticipationSeconds: number;
  /** Outgoing path framed after the junction (metres). */
  outgoingMeters: number;
  /** Below this speed a GPS course is not trusted (m/s). */
  courseSpeed: number;
  /** Below this speed the camera holds its bearing (stopped at lights, waiting to cross). */
  holdSpeed: number;
  /** Speed used to judge "within N seconds" when the fix reports none. */
  typicalSpeed: number;
  /** Presentation-only lead along the route, bounded to one fix interval. */
  extrapolate: boolean;
  /** Aim at Ferrostar's snapped position while alignment is credible. */
  snapToRoute: boolean;
  routeLookAhead: number;
  /** Bearing smoothing per fix (0..1) and dead band (degrees). */
  bearingGain: number;
  bearingDeadBand: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
export const CAMERA_PROFILES: Record<CameraMode, CameraProfile> = {
  walk: {
    pitch: 34, cruiseZoom: () => 18.3, minZoom: 16.9, anchor: 0.67, anticipationSeconds: 8, outgoingMeters: 30,
    courseSpeed: 0.8, holdSpeed: 0.35, typicalSpeed: 1.3, extrapolate: false, snapToRoute: false, routeLookAhead: 20,
    bearingGain: 0.5, bearingDeadBand: 4,
  },
  bicycle: {
    pitch: 42, cruiseZoom: speed => lerp(18, 17.1, (speed - 3) / 5), minZoom: 16.6, anchor: 0.715, anticipationSeconds: 10,
    outgoingMeters: 45, courseSpeed: 1.6, holdSpeed: 0.8, typicalSpeed: 4.5, extrapolate: true, snapToRoute: true,
    routeLookAhead: 25, bearingGain: 0.62, bearingDeadBand: 3,
  },
  car: {
    pitch: 48, cruiseZoom: speed => lerp(17.7, 15.7, (speed - 6) / 19), minZoom: 15.4, anchor: 0.735, anticipationSeconds: 12,
    outgoingMeters: 70, courseSpeed: 2.5, holdSpeed: 1.2, typicalSpeed: 9, extrapolate: true, snapToRoute: true,
    routeLookAhead: 35, bearingGain: 0.7, bearingDeadBand: 2.5,
  },
};

/** The unobscured map: between the bottom of the maneuver banner and the top of the bottom strip. */
export interface GuidanceViewport { width: number; height: number; top: number; bottom: number }

export interface CameraInput {
  mode: CameraMode;
  fix?: NavigationFix;
  /** A current accepted fix (not degraded, stale or paused). */
  usable: boolean;
  route: RouteMeasure | null;
  routeRevision?: number;
  progress?: RouteProgress;
  alignment?: 'aligned' | 'deviating' | 'unknown';
  snapped?: Coordinate;
  upcoming?: GuidanceManeuver;
  following?: FollowingManeuver;
  distanceToManeuverMeters?: number;
  viewport: GuidanceViewport;
  /** Transit walks: walking camera on the supplied trace, never turn framing. */
  traceOnly?: boolean;
}

export type PuckKind = 'wedge' | 'dot' | 'retained';
export interface CameraFrame {
  /** Identity of the fix this frame answers; equal keys mean "no new move". */
  key: string;
  center: Coordinate;
  bearing: number;
  pitch: number;
  zoom: number;
  padding: Padding;
  durationMs: number;
  easing: 'linear' | 'ease';
  /** Screen point where the camera centre (and the follow puck) is drawn. */
  anchor: ScreenPoint;
  puck: { coordinate: Coordinate; heading: number | null; kind: PuckKind };
  /** Junction + outgoing points the frame must show, for screen assertions. */
  framing: { maneuverId: string; points: Coordinate[] } | null;
  /** Lead added ahead of the accepted fix (presentation only, metres). */
  leadMeters: number;
}

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 1000; };
const TURN_FREE_TYPES = new Set(['arrive', 'depart']);
const STRAIGHT_TYPES = new Set(['continue', 'new name', 'notification', 'use lane']);
/** Whether a maneuver changes direction enough to deserve framing. */
export function framesManeuver(maneuver: GuidanceManeuver | undefined): boolean {
  if (!maneuver || TURN_FREE_TYPES.has(maneuver.type)) return false;
  return !(STRAIGHT_TYPES.has(maneuver.type) && (maneuver.modifier === undefined || maneuver.modifier === 'straight'));
}

/** Whether the following maneuver comes within about ten seconds of travel after the upcoming one. */
export function followsClosely(following: FollowingManeuver | undefined, typicalSpeed: number, seconds = 10): boolean {
  if (!following) return false;
  const byTime = following.afterUpcomingSeconds > 0 ? following.afterUpcomingSeconds : Infinity;
  const byDistance = following.afterUpcomingMeters / Math.max(0.5, typicalSpeed);
  return Math.min(byTime, byDistance) <= seconds;
}

/**
 * Stateful first-person camera planner, fed only by accepted native navigation state. One frame
 * per distinct fix (duplicate timestamps return the previous frame); the map animates linearly
 * to it over one fix interval, so puck and camera share one clock and React renders at 1 Hz.
 */
export class GuidanceCamera {
  private frame: CameraFrame | null = null;
  private lastFixMs: number | null = null;
  private intervals: number[] = [];
  private bearing: number | null = null;
  private bearingTrusted = false;
  /** Converging after leaving the dead band; stops once within half a degree (no residual tilt). */
  private rotating = false;
  private zoom: number | null = null;
  private cruise: number | null = null;
  private speed = 0;
  private latchedManeuver: string | null = null;
  private mode: CameraMode | null = null;
  private viewportKey = '';
  private recenters = 0;
  private previousFix: { coordinate: Coordinate; ms: number } | null = null;
  private derived: DerivedKinematics = {};

  get current() { return this.frame; }
  get expectedIntervalMs() { return this.intervals.length ? Math.min(2000, Math.max(600, median(this.intervals))) : 1000; }

  /** A one-off ~500 ms transition back to the follow pose (Ricentra). */
  recenter(): CameraFrame | null {
    if (!this.frame) return null;
    this.recenters += 1;
    this.frame = { ...this.frame, key: `${this.frame.key}#r${this.recenters}`, durationMs: 500, easing: 'ease' };
    return this.frame;
  }

  /**
   * Some providers omit speed and course. For presentation only, derive them from the previous
   * distinct accepted fix (0.5–3 s earlier); a move smaller than the fix noise yields no course.
   */
  private withKinematics(fix: NavigationFix): NavigationFix {
    const ms = fix.elapsedMs ?? fix.timestamp;
    const coordinate = { latitude: fix.latitude, longitude: fix.longitude };
    const previous = this.previousFix;
    if (previous && ms === previous.ms) return { ...fix, ...this.derived };
    this.previousFix = { coordinate, ms };
    this.derived = {};
    if (!previous || (fix.speedMps !== undefined && fix.course !== undefined)) return fix;
    const seconds = (ms - previous.ms) / 1000;
    if (seconds < 0.5 || seconds > 3) return fix;
    const moved = distanceMeters(previous.coordinate, coordinate);
    if (fix.speedMps === undefined) this.derived.speedMps = moved / seconds;
    if (fix.course === undefined && moved >= Math.max(1, 0.25 * fix.accuracyMeters)) {
      this.derived.course = bearingDegrees(previous.coordinate, coordinate);
      this.derived.courseAccuracyDegrees = 20;
    }
    return { ...fix, ...this.derived };
  }

  update(input: CameraInput): CameraFrame | null {
    const profile = CAMERA_PROFILES[input.mode];
    if (!input.fix) return this.frame;
    const fix = this.withKinematics(input.fix);
    const fixMs = fix.elapsedMs ?? fix.timestamp;
    const viewportKey = `${input.viewport.width}x${input.viewport.height}:${input.viewport.top}:${input.viewport.bottom}`;
    const modeChanged = this.mode !== input.mode;
    const layoutChanged = viewportKey !== this.viewportKey;
    // Duplicate or re-delivered samples (GPS + fused, a re-published snapshot) never move the camera.
    if (this.frame && fixMs === this.lastFixMs && !modeChanged && !layoutChanged) {
      const wasUsable = this.frame.puck.kind !== 'retained';
      if (wasUsable === input.usable) return this.frame;
      // Usability changed without a new fix: the camera holds still (no lead is taken back); only
      // the puck changes, drawn at the last accepted position.
      const coordinate = { latitude: fix.latitude, longitude: fix.longitude };
      this.frame = { ...this.frame, puck: { ...this.frame.puck, coordinate, kind: !input.usable ? 'retained' : this.bearingTrusted ? 'wedge' : 'dot' } };
      return this.frame;
    }
    if (modeChanged) { this.mode = input.mode; this.cruise = null; this.zoom = null; }
    this.viewportKey = viewportKey;

    let gapMs = 0;
    if (this.lastFixMs !== null && fixMs > this.lastFixMs) {
      gapMs = fixMs - this.lastFixMs;
      if (gapMs <= 3000) { this.intervals.push(gapMs); if (this.intervals.length > 5) this.intervals.shift(); }
    }
    const fresh = this.lastFixMs === null || fixMs !== this.lastFixMs;
    this.lastFixMs = fixMs;
    const interval = this.expectedIntervalMs;
    // A first fix, a fix after a long gap or a layout change eases instead of gliding.
    const recovering = this.frame === null || gapMs > 2.5 * interval || layoutChanged || modeChanged;

    if (fresh && fix.speedMps !== undefined) this.speed = this.speed * 0.6 + fix.speedMps * 0.4;
    const speed = fix.speedMps ?? this.speed;
    const route = input.route;
    const traveled = input.progress?.traveledMeters;
    const aligned = input.alignment === 'aligned' && route !== null && traveled !== undefined;
    const maneuverOffset = route && input.upcoming ? offsetOfIndex(route, input.upcoming.geometryIndex) : undefined;

    // Position: route-snapped only for cycling/driving while alignment is credible.
    const useSnapped = profile.snapToRoute && aligned && input.snapped !== undefined
      && distanceMeters(input.snapped, fix) <= Math.max(15, fix.accuracyMeters);
    const base: Coordinate = useSnapped ? input.snapped! : { latitude: fix.latitude, longitude: fix.longitude };

    // Course-up bearing, circularly filtered; held when slow or untrustworthy.
    const moving = fix.speedMps === undefined ? true : fix.speedMps >= profile.holdSpeed;
    if (!moving) this.rotating = false;
    const courseOk = fix.course !== undefined && (fix.speedMps ?? 0) >= profile.courseSpeed
      && (fix.courseAccuracyDegrees === undefined || fix.courseAccuracyDegrees <= 35);
    let target: number | null = null;
    if (input.usable && moving) {
      const routeBearing = aligned && !input.traceOnly
        ? routeBearingAt(route!, traveled!, profile.routeLookAhead, maneuverOffset ?? Infinity) : null;
      if (routeBearing !== null && courseOk && Math.abs(angleDelta(routeBearing, fix.course!)) > 45) target = fix.course!;
      else target = routeBearing ?? (courseOk ? fix.course! : null);
    }
    if (target !== null) {
      if (this.bearing === null) this.bearing = target;
      else {
        const delta = angleDelta(normalizeBearing(this.bearing), target);
        if (Math.abs(delta) > profile.bearingDeadBand) this.rotating = true;
        else if (Math.abs(delta) < 0.5) this.rotating = false;
        if (this.rotating) this.bearing += delta * (recovering ? 1 : profile.bearingGain);
      }
      this.bearingTrusted = true;
    }
    const bearing = this.bearing ?? 0;

    // Presentation-only lead: bounded to one interval, never through the upcoming maneuver,
    // never on a degraded, recovering or late fix. It never feeds navigation state.
    let center = base;
    let lead = 0;
    if (profile.extrapolate && input.usable && !recovering && !input.traceOnly && speed >= profile.courseSpeed) {
      lead = Math.min(30, speed * interval / 1000);
      if (useSnapped && route && traveled !== undefined) {
        if (maneuverOffset !== undefined) lead = Math.max(0, Math.min(lead, maneuverOffset - traveled - 3));
        center = pointAt(route, traveled + lead);
      } else if (courseOk) center = offsetCoordinate(base, fix.course!, lead);
      else lead = 0;
    }

    // Zoom: speed-aware cruise with hysteresis; turn framing pulls it out, release eases it back.
    const cruiseNow = profile.cruiseZoom(this.speed);
    if (this.cruise === null || Math.abs(cruiseNow - this.cruise) >= 0.3) this.cruise = cruiseNow;
    const anchorY = input.viewport.top + profile.anchor * Math.max(0, input.viewport.bottom - input.viewport.top);
    const padding = paddingForAnchor(input.viewport, anchorY);
    const size = { width: input.viewport.width, height: input.viewport.height };
    const rect: VisibleRect = { left: 16, right: input.viewport.width - 16, top: input.viewport.top + 12, bottom: input.viewport.bottom - 12 };

    let framing: CameraFrame['framing'] = null;
    let targetZoom = this.cruise;
    const upcoming = input.upcoming;
    if (upcoming && input.usable && !input.traceOnly && route && maneuverOffset !== undefined && traveled !== undefined && framesManeuver(upcoming)) {
      const toManeuver = input.distanceToManeuverMeters ?? Math.max(0, maneuverOffset - traveled);
      const seconds = toManeuver / Math.max(speed, profile.courseSpeed);
      if (this.latchedManeuver !== upcoming.id && seconds <= profile.anticipationSeconds) this.latchedManeuver = upcoming.id;
      if (this.latchedManeuver === upcoming.id) {
        const points = sample(sliceRoute(route, maneuverOffset, maneuverOffset + profile.outgoingMeters), 8);
        const following = input.following;
        if (following && followsClosely(following, profile.typicalSpeed)) {
          const followingOffset = offsetOfIndex(route, following.geometryIndex);
          points.push(...sample(sliceRoute(route, followingOffset, followingOffset + profile.outgoingMeters * 0.6), 6));
        }
        framing = { maneuverId: upcoming.id, points };
        targetZoom = solveZoom({ center, bearing: normalizeBearing(bearing), pitch: profile.pitch, padding, zoom: this.cruise }, size, rect, points, profile.minZoom);
      }
    }
    if (this.zoom === null || recovering) this.zoom = targetZoom;
    else {
      const seconds = Math.max(0.5, Math.min(2, interval / 1000));
      const delta = targetZoom - this.zoom;
      // Zoom out quickly enough to show the junction; ease back in over 2–3 s after the turn.
      const limit = (delta < 0 ? 1.1 : 0.45) * seconds;
      if (Math.abs(delta) >= 0.05) this.zoom += Math.max(-limit, Math.min(limit, delta));
    }

    const kind: PuckKind = !input.usable ? 'retained' : this.bearingTrusted ? 'wedge' : 'dot';
    this.frame = {
      key: `${fixMs}:${input.routeRevision ?? 0}:${input.mode}:${viewportKey}:${input.usable ? 1 : 0}`,
      center, bearing: normalizeBearing(bearing), pitch: profile.pitch, zoom: round(this.zoom, 3), padding,
      durationMs: recovering ? 500 : interval, easing: recovering ? 'ease' : 'linear',
      anchor: { x: input.viewport.width / 2, y: anchorY },
      puck: { coordinate: base, heading: this.bearingTrusted ? normalizeBearing(bearing) : null, kind },
      framing, leadMeters: round(lead, 1),
    };
    return this.frame;
  }
}

export interface DerivedKinematics { speedMps?: number; course?: number; courseAccuracyDegrees?: number }
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** At most `count` evenly spread points (always including both ends). */
function sample(points: Coordinate[], count: number): Coordinate[] {
  if (points.length <= count) return [...points];
  return Array.from({ length: count }, (_, i) => points[Math.round(i * (points.length - 1) / (count - 1))]!);
}

/** Largest zoom (≤ pose.zoom, ≥ minZoom) at which every point projects inside `rect`. */
export function solveZoom(pose: CameraPose, size: { width: number; height: number }, rect: VisibleRect, points: Coordinate[], minZoom: number): number {
  for (let zoom = pose.zoom; zoom >= minZoom; zoom -= 0.1) {
    const candidate = { ...pose, zoom };
    if (points.every(point => inside(project(candidate, size, point), rect))) return round(zoom, 2);
  }
  return minZoom;
}

/** Overview: the remaining route, north-up and flat, framed once. */
export function overviewBounds(route: RouteMeasure, traveled: number, position?: Coordinate): [number, number, number, number] | null {
  const points = sliceRoute(route, traveled, route.length);
  if (position) points.push(position);
  if (points.length === 0) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of points) {
    west = Math.min(west, point.longitude); east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude); north = Math.max(north, point.latitude);
  }
  const pad = 0.0004;
  return [west - pad, south - pad, east + pad, north + pad];
}

/** Follow / free / overview. Gestures enter free at gesture start; fixes and reroutes never leave it. */
export type CameraIntent = 'follow' | 'free' | 'overview';
export type CameraIntentEvent = 'gesture' | 'recenter' | 'overview' | 'reset';
export function nextIntent(current: CameraIntent, event: CameraIntentEvent): CameraIntent {
  switch (event) {
    case 'gesture': return 'free';
    case 'overview': return 'overview';
    case 'recenter': case 'reset': return 'follow';
  }
  return current;
}
