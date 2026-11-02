import { useMemo, useRef } from 'react';
import type { NavigationSnapshot } from '../../domain/navigation';
import type { Coordinate, RoutePlan } from '../../domain/types';
import type { MapCamera } from '../map/useMapCamera';
import { GuidanceCamera, overviewBounds, type CameraFrame, type CameraIntent, type CameraMode, type GuidanceViewport, type PuckKind } from './guidance-camera';
import { maneuverArrow, traveledFraction, type ManeuverArrow } from './guidance-route';
import { measureRoute, type RouteMeasure } from './route-measure';
import { sessionPlan } from './transit-follow';
import { legFitKey, type GuidanceFit } from './guidance-commands';
export type { GuidanceFit } from './guidance-commands';

/** What the map needs during guidance: camera intent and frames, the puck and the route styling. */
export interface GuidanceMapState {
  intent: CameraIntent;
  /** Road and transit walking modes; null while the camera only frames (transit without a fix). */
  mode: CameraMode | null;
  frame: CameraFrame | null;
  /** Overview of the remaining route, framed once per explicit request. */
  overview: GuidanceFit | null;
  /** Transit without a usable fix: the current leg and its stop, framed once per leg. */
  fit: GuidanceFit | null;
  puck: { coordinate: Coordinate; heading: number | null; kind: PuckKind } | null;
  /** Road route styling: travelled fraction and the arrow through the next junction. */
  route: { fraction: number; arrow: ManeuverArrow | null } | null;
  /** Called at gesture start: enters free immediately, before the region settles. */
  onUserGesture(): void;
}

const ROAD_MODES = new Set<string>(['walk', 'bicycle', 'car']);
/** Location states in which the accepted fix is current; anything else holds the camera. */
const LIVE_STATUSES = new Set<string>(['navigating', 'off-route', 'rerouting', 'routing']);
const FIX_FRESH_MS = 15_000;

function boundsOf(points: Coordinate[], pad = 0.0004): [number, number, number, number] | null {
  if (!points.length) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of points) {
    west = Math.min(west, point.longitude); east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude); north = Math.max(north, point.latitude);
  }
  return [west - pad, south - pad, east + pad, north + pad];
}

/**
 * First-person guidance camera, driven only by accepted native navigation state (no second
 * location stream, no MapLibre auto-tracking). One planner per session; one frame per distinct fix.
 * Transit access, transfer and final walks use the walking camera on the supplied trace when a
 * usable fix exists (still without turn instructions); otherwise the current leg and stop are framed.
 */
export function useGuidanceCamera({ snapshot, camera, viewport, active, transitPlan }: {
  snapshot: NavigationSnapshot; camera: MapCamera; viewport: GuidanceViewport; active: boolean; transitPlan?: RoutePlan | null;
}): GuidanceMapState | null {
  const planner = useRef<{ session: string | null; camera: GuidanceCamera; recenter: number } | null>(null);
  if (!planner.current || planner.current.session !== snapshot.sessionId) {
    planner.current = { session: snapshot.sessionId, camera: new GuidanceCamera(), recenter: camera.guidanceRecenter };
  }
  const transit = snapshot.mode === 'transit' ? snapshot.transit : undefined;
  const plan = transit ? sessionPlan(snapshot, transitPlan ?? null) : null;
  const legIndices = transit ? (transit.sourceLegIndices?.length ? transit.sourceLegIndices : [transit.legIndex]) : null;
  const legKey = legIndices?.join(',') ?? '';
  const legGeometry = useMemo(() => plan && legIndices ? legIndices.flatMap(index => plan.legs[index]?.geometry ?? []) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the leg indices
    [plan, legKey]);
  const walkingLeg = transit && (transit.phase === 'walk' || transit.phase === 'transfer');
  const geometry = transit ? (walkingLeg ? legGeometry : null) : snapshot.route?.geometry;
  const route = useMemo<RouteMeasure | null>(() => geometry && geometry.length > 1 ? measureRoute(geometry) : null, [geometry]);
  const location = snapshot.location;
  const fresh = location !== undefined && Date.now() - location.timestamp <= FIX_FRESH_MS;
  const usable = snapshot.locationUsable === true && LIVE_STATUSES.has(snapshot.status) && (!transit || fresh);
  const mode: CameraMode | null = snapshot.mode && ROAD_MODES.has(snapshot.mode) ? snapshot.mode as CameraMode
    : walkingLeg && usable ? 'walk' : null;
  const state = planner.current;
  let frame: CameraFrame | null = null;
  if (active && mode && location) {
    frame = state.camera.update(transit ? { mode, fix: location, usable, route, viewport, traceOnly: true } : {
      mode, fix: location, usable, route, routeRevision: snapshot.routeRevision,
      progress: snapshot.routeProgress, alignment: snapshot.alignment, snapped: snapshot.snappedLocation,
      upcoming: snapshot.upcomingManeuver, following: snapshot.followingManeuver,
      distanceToManeuverMeters: snapshot.distanceToManeuverMeters, viewport,
    });
    if (camera.guidanceRecenter !== state.recenter) { state.recenter = camera.guidanceRecenter; frame = state.camera.recenter() ?? frame; }
  }
  // Fits keep clear of every side: the banner, the strip and, in landscape, the side panel.
  const padding = useMemo(() => ({ top: viewport.top + 24, right: viewport.width - viewport.right + 32, bottom: viewport.height - viewport.bottom + 24, left: viewport.left + 32 }), [viewport]);
  const overviewKey = camera.guidanceOverview;
  const traveled = snapshot.routeProgress?.traveledMeters ?? 0;
  // Framed once per explicit request: later progress or a reroute never refits it.
  const planRoute = useMemo(() => plan?.geometry.length ? measureRoute(plan.geometry) : null, [plan]);
  const overviewRoute = transit ? planRoute : route;
  const overview = useMemo<GuidanceFit | null>(() => {
    if (!overviewRoute || overviewKey === 0) return null;
    const bounds = overviewBounds(overviewRoute, transit ? 0 : traveled, location ? { latitude: location.latitude, longitude: location.longitude } : undefined);
    return bounds ? { key: `overview:${overviewKey}`, bounds, padding } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately frozen until the next request
  }, [overviewKey, overviewRoute !== null]);
  const fit = useMemo<GuidanceFit | null>(() => {
    if (!transit || mode || !legGeometry?.length) return null;
    const bounds = boundsOf(legGeometry);
    // A new key per leg and per explicit Ricentra, so a recenter during a ride always reframes.
    return bounds ? { key: legFitKey(snapshot.sessionId, legKey, camera.guidanceRecenter), bounds, padding } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one frame per leg and recenter request
  }, [transit !== undefined, mode, legKey, legGeometry !== null, camera.guidanceRecenter]);
  const fraction = traveledFraction(route, snapshot.routeProgress);
  const upcoming = snapshot.upcomingManeuver;
  const arrow = useMemo(() => !transit && mode ? maneuverArrow(route, upcoming, mode, traveled) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arrow follows the maneuver id and coarse progress
    [route, upcoming?.id, mode, transit !== undefined, Math.round(traveled / 2)]);
  const { stopFollowing } = camera;
  if (!active || (!mode && !transit)) return null;
  const puck = frame?.puck ?? (location ? { coordinate: { latitude: location.latitude, longitude: location.longitude }, heading: null, kind: (usable ? 'dot' : 'retained') as PuckKind } : null);
  return {
    intent: camera.guidanceIntent, mode, frame, overview, fit, puck,
    route: !transit && route ? { fraction, arrow } : null, onUserGesture: stopFollowing,
  };
}
