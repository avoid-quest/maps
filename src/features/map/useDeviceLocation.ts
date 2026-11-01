import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/types';
import { getAuthorizedLocation, getCurrentLocation, LocationError } from '../../platform/location';
import type { TaskModel } from '../app/useTaskModel';
import { point } from './coordinates';
import { createRecenterIntent } from './recenter-intent';
import type { MapCamera } from './useMapCamera';

export type LocationOutcome = { coordinate: Coordinate } | { error: unknown };
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
   * `recenter` centres the camera on the first fix this request leads to, including one that
   * arrives after Android's permission dialog suspended the request.
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
  const request = useRef(0);
  const [recenter] = useState(createRecenterIntent);
  const { dispatch } = tasks;
  const { adoptInitialFix, centerOnFix } = camera;
  const record = useCallback((coordinate: Coordinate | null) => setFix(coordinate ? { coordinate, at: Date.now() } : null), []);
  /** Lifecycle suspension: stops the request but keeps an explicit Locate's intent to centre. */
  const suspend = useCallback(() => {
    request.current += 1;
    setLocating(false);
    dispatch({ type: 'locationRequestCancelled' });
  }, [dispatch]);
  const cancel = useCallback(() => {
    recenter.withdraw();
    suspend();
  }, [recenter, suspend]);
  /** A fix from any request centres the camera when Locate is still pending, else only adopts an untouched camera. */
  const place = useCallback((coordinate: Coordinate) => {
    if (recenter.take(Date.now()) === 'center') centerOnFix(coordinate);
    else adoptInitialFix(coordinate);
  }, [recenter, centerOnFix, adoptInitialFix]);
  const acquire = useCallback(async (options?: { recenter?: boolean }): Promise<LocationOutcome | null> => {
    const id = ++request.current;
    if (options?.recenter) recenter.request(id, Date.now());
    setLocating(true);
    try {
      const position = await getCurrentLocation();
      const next = point(position.coordinate);
      if (id !== request.current) {
        // Suspended by the lifecycle (permission dialog) but not by the user: honour a pending Locate.
        if (recenter.pending(Date.now())) { record(next); place(next); }
        return null;
      }
      record(next);
      if (options?.recenter) place(next);
      return { coordinate: next };
    } catch (error) {
      // A denial ends a pending Locate even after the dialog suspended the request; an interruption by
      // the lifecycle does not (the foreground acquisition on return still brings a fix).
      const denied = error instanceof LocationError && error.code === 'denied';
      if (id === request.current || denied) recenter.failed(id);
      return id === request.current ? { error } : null;
    } finally {
      if (id === request.current) setLocating(false);
    }
  }, [recenter, record, place]);

  useEffect(() => {
    if (!appActive) { suspend(); record(null); return; }
    if (navigationVisible) return;
    let active = true;
    const id = request.current;
    setLocating(true);
    void getAuthorizedLocation().then(position => {
      if (!position) { recenter.notAuthorized(); return; }
      if (!active) return;
      setMessage('');
      const next = point(position.coordinate);
      record(next);
      if (id === request.current) place(next);
    }).catch(error => {
      if (active && id === request.current) {
        record(null);
        recenter.notAuthorized();
        setMessage(error instanceof Error ? error.message : 'Posizione non disponibile. Riprova dal pulsante posizione.');
      }
    }).finally(() => {
      if (active && id === request.current) setLocating(false);
    });
    return () => { active = false; };
  }, [appActive, navigationVisible, suspend, record, place, recenter]);

  return { coordinate: fix?.coordinate ?? null, fixedAt: fix?.at ?? null, locating, message, setMessage, cancel, acquire, accept: record };
}
