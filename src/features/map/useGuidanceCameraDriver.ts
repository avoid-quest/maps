import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { GuidanceMapState } from '../navigation/useGuidanceCamera';
import type { CameraFrame } from '../navigation/guidance-camera';
import { project } from '../navigation/map-projection';

/** Development-only screen assertions, read from the device log (`[nav-cam]`). */
const ASSERT = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Issues the guidance camera: one native ease per frame in follow, one fit per overview request,
 * nothing in free. A gesture is reported at its start and blocks every pending move at once.
 */
export function useGuidanceCameraDriver({ guidance, loaded, camera, map, commands, size }: {
  guidance: GuidanceMapState | null; loaded: boolean; camera: RefObject<CameraRef | null>; map: RefObject<MapRef | null>;
  commands: RefObject<number>; size: RefObject<{ width: number; height: number }>;
}) {
  const intent = guidance?.intent;
  const frame = guidance?.frame ?? null;
  const overview = guidance?.overview ?? null;
  const fit = guidance?.fit ?? null;
  const issued = useRef<string | null>(null);
  const overviewIssued = useRef<string | null>(null);
  const fitIssued = useRef<string | null>(null);
  const gestureActive = useRef(false);
  const latest = useRef(guidance);
  latest.current = guidance;
  useEffect(() => { if (intent !== 'free') gestureActive.current = false; }, [intent]);
  useEffect(() => {
    if (!loaded || !frame || intent !== 'follow' || gestureActive.current || issued.current === frame.key) return;
    issued.current = frame.key;
    commands.current += 1;
    camera.current?.easeTo({
      center: [frame.center.longitude, frame.center.latitude], bearing: frame.bearing, pitch: frame.pitch, zoom: frame.zoom,
      padding: frame.padding, duration: frame.durationMs, easing: frame.easing,
    });
    if (ASSERT) assertFrame(map, frame, size.current, latest);
  }, [loaded, frame, intent, camera, map, commands, size]);
  useEffect(() => {
    if (!loaded || !overview || intent !== 'overview' || overviewIssued.current === overview.key) return;
    overviewIssued.current = overview.key;
    commands.current += 1;
    camera.current?.fitBounds(overview.bounds, { padding: overview.padding, bearing: 0, pitch: 0, duration: 700 });
  }, [loaded, overview, intent, camera, commands]);
  // Transit without a usable fix: frame the current leg and its stop once per leg (flat, north-up).
  useEffect(() => {
    if (!loaded || frame || !fit || intent !== 'follow' || gestureActive.current || fitIssued.current === fit.key) return;
    fitIssued.current = fit.key;
    commands.current += 1;
    camera.current?.fitBounds(fit.bounds, { padding: fit.padding, bearing: 0, pitch: 0, duration: 700 });
  }, [loaded, frame, fit, intent, camera, commands]);
  useEffect(() => { if (!guidance) { issued.current = null; overviewIssued.current = null; fitIssued.current = null; } }, [guidance]);
  return useCallback(() => {
    const current = latest.current;
    if (!current) return;
    gestureActive.current = true;
    if (ASSERT) console.log(`[nav-cam] gesture intent=${current.intent} at=${Date.now()}`);
    if (current.intent !== 'free') current.onUserGesture();
  }, []);
}

/**
 * Near the end of the move, compare MapLibre's own projection with the planned anchor and framing:
 * the camera centre must land on the anchor, the junction and outgoing path inside the map.
 */
function assertFrame(map: RefObject<MapRef | null>, frame: CameraFrame, size: { width: number; height: number }, latest: RefObject<GuidanceMapState | null | undefined>) {
  const issuedAt = Date.now();
  setTimeout(() => {
    const ref = map.current;
    // Guidance ended or the camera left follow: nothing to assert.
    if (!ref || latest.current?.intent !== 'follow') return;
    const puck: [number, number] = [frame.center.longitude, frame.center.latitude];
    const junction = frame.framing?.points[0];
    void Promise.all([
      ref.project(puck), ref.getZoom(), ref.getBearing(), ref.getPitch(),
      junction ? ref.project([junction.longitude, junction.latitude]) : Promise.resolve(null),
    ]).then(([screen, zoom, bearing, pitch, junctionScreen]) => {
      const predicted = junction ? project(frame, size, junction) : null;
      const row = {
        key: frame.key.split(':')[0], dt: Date.now() - issuedAt, dur: frame.durationMs, anchorY: round(frame.anchor.y), puckY: round(screen[1]), puckX: round(screen[0]),
        dyPct: round(100 * (screen[1] - frame.anchor.y) / size.height, 2), zoom: round(zoom, 2), zoomCmd: frame.zoom, bearing: round(bearing, 1), bearingCmd: round(frame.bearing, 1),
        pitch: round(pitch, 1), lead: frame.leadMeters, framing: frame.framing?.maneuverId ?? null,
        junction: junctionScreen ? [round(junctionScreen[0]), round(junctionScreen[1])] : null,
        junctionPredicted: predicted ? [round(predicted.x), round(predicted.y)] : null,
      };
      console.log(`[nav-cam] ${JSON.stringify(row)}`);
    }).catch(() => undefined);
  }, Math.max(0, frame.durationMs - 60));
}
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
