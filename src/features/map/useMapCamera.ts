import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { nextIntent, type CameraIntent, type CameraIntentEvent } from '../navigation/guidance-camera';
import { TURIN_OVERVIEW } from './coordinates';
import { createViewportStore, mayPersistSettledView } from './viewport-store';

/** What the camera currently shows, so a fallback is never presented as the user's position. */
export type CameraView = 'overview' | 'restored' | 'located' | 'chosen';

export interface MapCamera {
  center: Coordinate;
  zoom: number;
  /** Changes on every commanded move, including to an unchanged coordinate. */
  revision: number;
  /** The area explicit searches and nearby stops refer to. */
  searchCenter: Coordinate;
  /** The user panned away from the search area. */
  areaChanged: boolean;
  /** Guidance follows accepted positions until the user pans. */
  following: boolean;
  /** Guidance camera intent: follow, free (after a gesture) or overview. */
  guidanceIntent: CameraIntent;
  /** Changes on every explicit Ricentra, so the camera issues exactly one transition. */
  guidanceRecenter: number;
  /** Changes on every explicit overview request; the remaining route is framed once per value. */
  guidanceOverview: number;
  /** Changes when the user asks to frame the planning route again. */
  frameRevision: number;
  /** The launch overview, a restored view, a fix, or a view the user chose. */
  view: CameraView;
  /** The centre the map actually shows after its last settled move, user-driven or programmatic. */
  viewCenter: Coordinate;
  viewport(): Coordinate;
  /** Records an intentional camera choice, which a late background fix must respect. */
  touch(): void;
  /** Moves to a selected place or stop at street zoom. */
  focus(coordinate: Coordinate): void;
  moveTo(coordinate: Coordinate): void;
  /** Explicit Locate: centre on the fix and search around it. */
  centerOnFix(coordinate: Coordinate): void;
  /** A launch fix moves the camera only if the user has not moved it. */
  adoptInitialFix(coordinate: Coordinate): void;
  searchHere(): void;
  userMoved(coordinate: Coordinate, zoom?: number): void;
  /** Any settled camera move reported by the map outside guidance, including fits and animations. */
  viewSettled(coordinate: Coordinate, zoom?: number): void;
  /** A guidance-map gesture began: enter free immediately and keep it until Ricentra. */
  stopFollowing(): void;
  follow(): void;
  recenterGuidance(): void;
  /** Frame the remaining route north-up and flat, once. */
  overviewGuidance(): void;
  frameRoute(): void;
  /** Forgets the stored last view; the next launch without a fix opens on the overview. */
  forgetLastView(): Promise<boolean>;
}

const viewportStore = createViewportStore(AsyncStorage);

/** Whether a settled view differs from the launch overview (about 50 m or a quarter zoom level). */
export function movedFromOverview(center: Coordinate, zoom: number): boolean {
  return Math.abs(center.latitude - TURIN_OVERVIEW.center.latitude) + Math.abs(center.longitude - TURIN_OVERVIEW.center.longitude) > 0.0006
    || Math.abs(zoom - TURIN_OVERVIEW.zoom) > 0.25;
}
const SAVE_DELAY_MS = 1500;

/**
 * Camera intent: commanded positions, the explicit search area, and following. Without a fix the
 * map opens on the last view stored on this device, else on a labelled Turin overview.
 */
export function useMapCamera(): MapCamera {
  const [center, setCenterState] = useState<Coordinate>(TURIN_OVERVIEW.center);
  const [zoom, setZoom] = useState<number>(TURIN_OVERVIEW.zoom);
  const [revision, setRevision] = useState(0);
  const [searchCenter, setSearchCenterState] = useState<Coordinate>(TURIN_OVERVIEW.center);
  const searchCenterRef = useRef<Coordinate>(TURIN_OVERVIEW.center);
  const [areaChanged, setAreaChanged] = useState(false);
  const [guidanceIntent, setGuidanceIntent] = useState<CameraIntent>('follow');
  const [guidanceRecenter, setGuidanceRecenter] = useState(0);
  const [guidanceOverview, setGuidanceOverview] = useState(0);
  const intentEvent = useCallback((event: CameraIntentEvent) => setGuidanceIntent(current => nextIntent(current, event)), []);
  const [frameRevision, setFrameRevision] = useState(0);
  const [view, setView] = useState<CameraView>('overview');
  const [viewCenter, setViewCenter] = useState<Coordinate>(TURIN_OVERVIEW.center);
  const viewportRef = useRef<Coordinate>(TURIN_OVERVIEW.center);
  const zoomRef = useRef<number>(TURIN_OVERVIEW.zoom);
  const touched = useRef(false);
  /** An explicit Locate centred the camera: user engagement. */
  const located = useRef(false);
  /** A passive launch fix was adopted: blocks a late restore but is not engagement, so it is not saved. */
  const adopted = useRef(false);
  // Set by forgetLastView; cleared only by a deliberate camera choice (pan, focus, Locate).
  const forgotten = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setCenter = useCallback((next: Coordinate) => {
    viewportRef.current = next;
    setCenterState(next);
    setRevision(value => value + 1);
  }, []);
  const setCameraZoom = useCallback((next: number) => { zoomRef.current = next; setZoom(next); }, []);
  const setSearchCenter = useCallback((next: Coordinate) => {
    searchCenterRef.current = next;
    setSearchCenterState(next);
  }, []);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void viewportStore.save(viewportRef.current, zoomRef.current); }, SAVE_DELAY_MS);
  }, []);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    let active = true;
    void viewportStore.load().then(stored => {
      // A late load never overrides a fix or a choice, nor resurrects a view the user just forgot.
      if (!active || !stored || touched.current || located.current || adopted.current || forgotten.current) return;
      setCenter(stored.center); setCameraZoom(stored.zoom); setSearchCenter(stored.center); setView('restored');
    });
    return () => { active = false; };
  }, [setCenter, setCameraZoom, setSearchCenter]);
  const actions = useMemo(() => ({
    viewport: () => viewportRef.current,
    touch: () => { touched.current = true; },
    focus: (coordinate: Coordinate) => { touched.current = true; forgotten.current = false; setCameraZoom(15); setCenter(coordinate); setView('chosen'); scheduleSave(); },
    moveTo: setCenter,
    centerOnFix: (coordinate: Coordinate) => {
      located.current = true; forgotten.current = false;
      setCenter(coordinate); setCameraZoom(15); setSearchCenter(coordinate); setAreaChanged(false); setView('located'); scheduleSave();
    },
    adoptInitialFix: (coordinate: Coordinate) => {
      if (touched.current) return;
      adopted.current = true;
      setCenter(coordinate); setCameraZoom(15); setSearchCenter(coordinate); setView('located');
    },
    searchHere: () => { setSearchCenter(viewportRef.current); setAreaChanged(false); },
    userMoved: (coordinate: Coordinate, nextZoom?: number) => {
      touched.current = true; forgotten.current = false;
      viewportRef.current = coordinate;
      if (nextZoom !== undefined && Number.isFinite(nextZoom)) zoomRef.current = nextZoom;
      setView('chosen');
      scheduleSave();
      const area = searchCenterRef.current;
      if (Math.abs(coordinate.longitude - area.longitude) + Math.abs(coordinate.latitude - area.latitude) > 0.004) setAreaChanged(true);
    },
    viewSettled: (coordinate: Coordinate, settledZoom?: number) => {
      viewportRef.current = coordinate;
      if (settledZoom !== undefined && Number.isFinite(settledZoom)) zoomRef.current = settledZoom;
      setViewCenter(current => Math.abs(current.latitude - coordinate.latitude) + Math.abs(current.longitude - coordinate.longitude) < 1e-6 ? current : coordinate);
      // A fit to results or a route away from the launch overview is no longer "Panoramica di Torino".
      if (movedFromOverview(coordinate, zoomRef.current)) setView(current => current === 'overview' ? 'chosen' : current);
      // Programmatic fits are what the user last saw too; persist them once the user has engaged.
      if (mayPersistSettledView({ engaged: touched.current || located.current, forgotten: forgotten.current })) scheduleSave();
    },
    stopFollowing: () => intentEvent('gesture'),
    follow: () => intentEvent('reset'),
    recenterGuidance: () => { intentEvent('recenter'); setGuidanceRecenter(value => value + 1); setRevision(value => value + 1); },
    overviewGuidance: () => { intentEvent('overview'); setGuidanceOverview(value => value + 1); },
    frameRoute: () => setFrameRevision(value => value + 1),
    forgetLastView: () => { forgotten.current = true; clearTimeout(saveTimer.current); return viewportStore.clear(); },
  }), [setCenter, setCameraZoom, setSearchCenter, scheduleSave, intentEvent]);
  const following = guidanceIntent === 'follow';
  return { center, zoom, revision, searchCenter, areaChanged, following, guidanceIntent, guidanceRecenter, guidanceOverview, frameRevision, view, viewCenter, ...actions };
}
