import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { getAuthorizedLocation, getCurrentLocation } from '../../platform/location';
import type { TaskModel } from '../app/useTaskModel';
import { point } from './coordinates';
import type { MapCamera } from './useMapCamera';

export type LocationOutcome = { coordinate: Coordinate } | { error: unknown };
export interface DeviceLocation {
  /** The last browsing fix; never a navigation-quality position. */
  coordinate: Coordinate | null;
  locating: boolean;
  message: string;
  setMessage(message: string): void;
  /** Supersedes any pending request, including a planner origin request. */
  cancel(): void;
  /** Requests a fresh fix; resolves null when a later request or cancellation superseded it. */
  acquire(): Promise<LocationOutcome | null>;
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
  const [coordinate, setCoordinate] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const { dispatch } = tasks;
  const { adoptInitialFix } = camera;
  const cancel = useCallback(() => {
    request.current += 1;
    setLocating(false);
    dispatch({ type: 'locationRequestCancelled' });
  }, [dispatch]);
  const acquire = useCallback(async (): Promise<LocationOutcome | null> => {
    const id = ++request.current;
    setLocating(true);
    try {
      const position = await getCurrentLocation();
      if (id !== request.current) return null;
      const next = point(position.coordinate);
      setCoordinate(next);
      return { coordinate: next };
    } catch (error) {
      return id === request.current ? { error } : null;
    } finally {
      if (id === request.current) setLocating(false);
    }
  }, []);

  useEffect(() => {
    if (!appActive) { cancel(); setCoordinate(null); return; }
    if (navigationVisible) return;
    let active = true;
    const id = request.current;
    setLocating(true);
    void getAuthorizedLocation().then(position => {
      if (!active || !position) return;
      setMessage('');
      const next = point(position.coordinate);
      setCoordinate(next);
      if (id === request.current) adoptInitialFix(next);
    }).catch(error => {
      if (active && id === request.current) {
        setCoordinate(null);
        setMessage(error instanceof Error ? error.message : 'Posizione non disponibile. Riprova dal pulsante posizione.');
      }
    }).finally(() => {
      if (active && id === request.current) setLocating(false);
    });
    return () => { active = false; };
  }, [appActive, navigationVisible, cancel, adoptInitialFix]);

  return { coordinate, locating, message, setMessage, cancel, acquire, accept: setCoordinate };
}
