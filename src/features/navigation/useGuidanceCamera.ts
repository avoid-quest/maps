import { useMemo, useRef } from 'react';
import type { NavigationSnapshot } from '../../domain/navigation';
import type { MapCamera } from '../map/useMapCamera';
import { GuidanceCamera, overviewBounds, type CameraFrame, type CameraIntent, type CameraMode, type GuidanceViewport } from './guidance-camera';
import type { Padding } from './map-projection';
import { measureRoute } from './route-measure';

export interface GuidanceOverview { key: number; bounds: [number, number, number, number]; padding: Padding }
/** What the map needs during guidance: the camera intent, the follow frame and an overview frame. */
export interface GuidanceMapState {
  intent: CameraIntent;
  frame: CameraFrame | null;
  overview: GuidanceOverview | null;
  /** Called at gesture start: enters free immediately, before the region settles. */
  onUserGesture(): void;
}

const ROAD_MODES = new Set<string>(['walk', 'bicycle', 'car']);
/** Location states in which the accepted fix is current; anything else holds the camera. */
const LIVE_STATUSES = new Set<string>(['navigating', 'off-route', 'rerouting', 'routing']);

/**
 * First-person guidance camera, driven only by accepted native navigation state (no second
 * location stream, no MapLibre auto-tracking). One planner per session; one frame per distinct fix.
 */
export function useGuidanceCamera({ snapshot, camera, viewport, active }: {
  snapshot: NavigationSnapshot; camera: MapCamera; viewport: GuidanceViewport; active: boolean;
}): GuidanceMapState | null {
  const planner = useRef<{ session: string | null; camera: GuidanceCamera; recenter: number } | null>(null);
  const mode = snapshot.mode && ROAD_MODES.has(snapshot.mode) ? snapshot.mode as CameraMode : null;
  if (!planner.current || planner.current.session !== snapshot.sessionId) {
    planner.current = { session: snapshot.sessionId, camera: new GuidanceCamera(), recenter: camera.guidanceRecenter };
  }
  const geometry = snapshot.route?.geometry;
  const route = useMemo(() => geometry && geometry.length > 1 ? measureRoute(geometry) : null, [geometry]);
  const usable = snapshot.locationUsable === true && LIVE_STATUSES.has(snapshot.status);
  const state = planner.current;
  let frame: CameraFrame | null = null;
  if (active && mode && snapshot.location) {
    frame = state.camera.update({
      mode, fix: snapshot.location, usable, route, routeRevision: snapshot.routeRevision,
      progress: snapshot.routeProgress, alignment: snapshot.alignment, snapped: snapshot.snappedLocation,
      upcoming: snapshot.upcomingManeuver, following: snapshot.followingManeuver,
      distanceToManeuverMeters: snapshot.distanceToManeuverMeters, viewport,
    });
    if (camera.guidanceRecenter !== state.recenter) { state.recenter = camera.guidanceRecenter; frame = state.camera.recenter() ?? frame; }
  }
  const overviewKey = camera.guidanceOverview;
  const traveled = snapshot.routeProgress?.traveledMeters ?? 0;
  const location = snapshot.location;
  // Framed once per explicit request: later progress or a reroute never refits it.
  const overview = useMemo<GuidanceOverview | null>(() => {
    if (!route || overviewKey === 0) return null;
    const bounds = overviewBounds(route, traveled, location ? { latitude: location.latitude, longitude: location.longitude } : undefined);
    if (!bounds) return null;
    return { key: overviewKey, bounds, padding: { top: viewport.top + 24, right: 32, bottom: viewport.height - viewport.bottom + 24, left: 32 } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately frozen until the next request
  }, [overviewKey, route]);
  const { stopFollowing } = camera;
  if (!active || !mode) return null;
  return { intent: camera.guidanceIntent, frame, overview, onUserGesture: stopFollowing };
}
