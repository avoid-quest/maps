import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { getAuthorizedLocation, getCurrentLocation } from '../../platform/location';
import type { TaskModel } from '../app/useTaskModel';
import { toCoordinate } from './coordinates';
import { createLocationRequests, type LocationOutcome } from './location-requests';
import type { MapCamera } from './useMapCamera';

export type { LocationOutcome };
export interface DeviceLocation {
  /** The last browsing fix; never a navigation-quality position. */
  coordinate: Coordinate | null;
  /** When `coordinate` was received (device clock), for freshness decisions such as distances. */
  fixedAt: number | null;
  locating: boolean;
  message: string;
  setMessage(message: string): void;
  /** A user choice supersedes any pending request, including a planner origin request and a pending Locate centre. */
  cancel(): void;
  /**
   * Requests a fresh fix; resolves null when a later request or cancellation superseded it.
   * `recenter` (Locate) centres the camera on the first fix this request leads to and resolves with
   * it, including one that arrives after Android's permission dialog suspended the request.
   */
  acquire(options?: { recenter?: boolean }): Promise<LocationOutcome | null>;
  /** Adopts a position accepted elsewhere, such as the last guidance position. */
  accept(coordinate: Coordinate): void;
}

/**
 * Foreground browsing location. While the app is active and guidance is not visible,
 * an already-authorized fix is requested once; explicit requests go through acquire.
 */
export function useDeviceLocation({ tasks, camera, appActive, navigationVisible }: {
  tasks: TaskModel; camera: MapCamera; appActive: boolean; navigationVisible: boolean;
}): DeviceLocation {
  const [fix, setFix] = useState<{ coordinate: Coordinate; at: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const { dispatch } = tasks;
  const { adoptInitialFix, centerOnFix } = camera;
  const record = useCallback((coordinate: Coordinate | null) => setFix(coordinate ? { coordinate, at: Date.now() } : null), []);
  const latest = useRef({ record, centerOnFix, adoptInitialFix, dispatch });
  useLayoutEffect(() => { latest.current = { record, centerOnFix, adoptInitialFix, dispatch }; });
  const [requests] = useState(() => createLocationRequests({
    locate: async () => toCoordinate((await getCurrentLocation()).coordinate),
    now: Date.now,
    record: coordinate => latest.current.record(coordinate),
    center: coordinate => latest.current.centerOnFix(coordinate),
    adopt: coordinate => latest.current.adoptInitialFix(coordinate),
    setLocating,
    cancelled: () => latest.current.dispatch({ type: 'locationRequestCancelled' }),
  }));
  const { suspend, cancel, acquire } = requests;

  useEffect(() => {
    if (!appActive) { suspend(); record(null); return; }
    if (navigationVisible) return;
    let active = true;
    const id = requests.current();
    setLocating(true);
    void getAuthorizedLocation().then(position => {
      // Only this check's own outcome may end the intent; a newer Locate is not cancelled by it.
      if (!position) { requests.foregroundFailed(id); return; }
      if (!active) return;
      setMessage('');
      requests.foregroundFix(toCoordinate(position.coordinate), id);
    }).catch(error => {
      if (active && id === requests.current()) {
        record(null);
        setMessage(error instanceof Error ? error.message : 'Posizione non disponibile. Riprova dal pulsante posizione.');
        requests.foregroundFailed(id, error);
      }
    }).finally(() => {
      if (active && id === requests.current()) setLocating(false);
    });
    return () => { active = false; };
  }, [appActive, navigationVisible, suspend, record, requests]);

  return { coordinate: fix?.coordinate ?? null, fixedAt: fix?.at ?? null, locating, message, setMessage, cancel, acquire, accept: record };
}
