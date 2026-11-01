import { useCallback, useMemo, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { INITIAL_MAP } from './coordinates';

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
  userMoved(coordinate: Coordinate): void;
  stopFollowing(): void;
  follow(): void;
  recenterGuidance(): void;
  frameRoute(): void;
}

/** Camera intent: commanded positions, the explicit search area, and following. */
export function useMapCamera(): MapCamera {
  const [center, setCenterState] = useState(INITIAL_MAP);
  const [zoom, setZoom] = useState(5);
  const [revision, setRevision] = useState(0);
  const [searchCenter, setSearchCenterState] = useState(INITIAL_MAP);
  const searchCenterRef = useRef(INITIAL_MAP);
  const [areaChanged, setAreaChanged] = useState(false);
  const [following, setFollowing] = useState(true);
  const [frameRevision, setFrameRevision] = useState(0);
  const viewportRef = useRef(INITIAL_MAP);
  const touched = useRef(false);
  const setCenter = useCallback((next: Coordinate) => {
    viewportRef.current = next;
    setCenterState(next);
    setRevision(value => value + 1);
  }, []);
  const setSearchCenter = useCallback((next: Coordinate) => {
    searchCenterRef.current = next;
    setSearchCenterState(next);
  }, []);
  const actions = useMemo(() => ({
    viewport: () => viewportRef.current,
    touch: () => { touched.current = true; },
    focus: (coordinate: Coordinate) => { touched.current = true; setZoom(15); setCenter(coordinate); },
    moveTo: setCenter,
    centerOnFix: (coordinate: Coordinate) => {
      setCenter(coordinate); setZoom(15); setSearchCenter(coordinate); setAreaChanged(false);
    },
    adoptInitialFix: (coordinate: Coordinate) => {
      if (touched.current) return;
      setCenter(coordinate); setZoom(15); setSearchCenter(coordinate);
    },
    searchHere: () => { setSearchCenter(viewportRef.current); setAreaChanged(false); },
    userMoved: (coordinate: Coordinate) => {
      touched.current = true;
      viewportRef.current = coordinate;
      const area = searchCenterRef.current;
      if (Math.abs(coordinate.longitude - area.longitude) + Math.abs(coordinate.latitude - area.latitude) > 0.004) setAreaChanged(true);
    },
    stopFollowing: () => setFollowing(false),
    follow: () => setFollowing(true),
    recenterGuidance: () => { setFollowing(true); setRevision(value => value + 1); },
    frameRoute: () => setFrameRevision(value => value + 1),
  }), [setCenter, setSearchCenter]);
  return { center, zoom, revision, searchCenter, areaChanged, following, frameRevision, ...actions };
}
