import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { TURIN_OVERVIEW } from './coordinates';
import { createViewportStore } from './viewport-store';

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
  /** Changes when the user asks to frame the planning route again. */
  frameRevision: number;
  /** The launch overview, a restored view, a fix, or a view the user chose. */
  view: CameraView;
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
  stopFollowing(): void;
  follow(): void;
  recenterGuidance(): void;
  frameRoute(): void;
  /** Forgets the stored last view; the next launch without a fix opens on the overview. */
  forgetLastView(): Promise<boolean>;
}

const viewportStore = createViewportStore(AsyncStorage);
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
  const [following, setFollowing] = useState(true);
  const [frameRevision, setFrameRevision] = useState(0);
  const [view, setView] = useState<CameraView>('overview');
  const viewportRef = useRef<Coordinate>(TURIN_OVERVIEW.center);
  const zoomRef = useRef<number>(TURIN_OVERVIEW.zoom);
  const touched = useRef(false);
  const located = useRef(false);
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
      if (!active || !stored || touched.current || located.current) return;
      setCenter(stored.center); setCameraZoom(stored.zoom); setSearchCenter(stored.center); setView('restored');
    });
    return () => { active = false; };
  }, [setCenter, setCameraZoom, setSearchCenter]);
  const actions = useMemo(() => ({
    viewport: () => viewportRef.current,
    touch: () => { touched.current = true; },
    focus: (coordinate: Coordinate) => { touched.current = true; setCameraZoom(15); setCenter(coordinate); setView('chosen'); scheduleSave(); },
    moveTo: setCenter,
    centerOnFix: (coordinate: Coordinate) => {
      located.current = true;
      setCenter(coordinate); setCameraZoom(15); setSearchCenter(coordinate); setAreaChanged(false); setView('located'); scheduleSave();
    },
    adoptInitialFix: (coordinate: Coordinate) => {
      if (touched.current) return;
      located.current = true;
      setCenter(coordinate); setCameraZoom(15); setSearchCenter(coordinate); setView('located');
    },
    searchHere: () => { setSearchCenter(viewportRef.current); setAreaChanged(false); },
    userMoved: (coordinate: Coordinate, nextZoom?: number) => {
      touched.current = true;
      viewportRef.current = coordinate;
      if (nextZoom !== undefined && Number.isFinite(nextZoom)) zoomRef.current = nextZoom;
      setView('chosen');
      scheduleSave();
      const area = searchCenterRef.current;
      if (Math.abs(coordinate.longitude - area.longitude) + Math.abs(coordinate.latitude - area.latitude) > 0.004) setAreaChanged(true);
    },
    stopFollowing: () => setFollowing(false),
    follow: () => setFollowing(true),
    recenterGuidance: () => { setFollowing(true); setRevision(value => value + 1); },
    frameRoute: () => setFrameRevision(value => value + 1),
    forgetLastView: () => { clearTimeout(saveTimer.current); return viewportStore.clear(); },
  }), [setCenter, setCameraZoom, setSearchCenter, scheduleSave]);
  return { center, zoom, revision, searchCenter, areaChanged, following, frameRevision, view, ...actions };
}
