import { useCallback } from 'react';
import type { Coordinate } from '../../domain/types';
import { createFeatureContext } from '../app/feature-context';
import { plannerTask } from '../app/task-model';
import type { TaskModel } from '../app/useTaskModel';
import type { DeviceLocation } from './useDeviceLocation';
import type { MapCamera } from './useMapCamera';

export interface MapModel {
  camera: MapCamera;
  location: DeviceLocation;
  /** The location control: recentres, and in a planner also requests a fresh origin. */
  locate(): Promise<void>;
  /** Searches the visible area explicitly, closing detail tasks. */
  searchArea(): void;
  /** A user pan: cancels pending location intent and, without an origin, starts origin picking. */
  userPanned(coordinate: Coordinate): void;
}

export function useMapModel({ tasks, camera, location }: { tasks: TaskModel; camera: MapCamera; location: DeviceLocation }): MapModel {
  const { dispatch, getState } = tasks;
  const locate = useCallback(async () => {
    camera.touch();
    const planning = plannerTask(getState()) !== null;
    if (planning) dispatch({ type: 'locateOrigin' });
    location.setMessage('');
    const outcome = await location.acquire();
    if (!outcome) return;
    if ('coordinate' in outcome) {
      camera.centerOnFix(outcome.coordinate);
      if (planning) dispatch({ type: 'originLocated', coordinate: outcome.coordinate });
    } else {
      if (planning) dispatch({ type: 'originLocateFailed' });
      location.setMessage(outcome.error instanceof Error ? outcome.error.message : 'Posizione non disponibile. Puoi continuare a esplorare la mappa.');
    }
  }, [camera, location, getState, dispatch]);
  const searchArea = useCallback(() => {
    location.cancel();
    camera.searchHere();
    dispatch({ type: 'closeDetails' });
  }, [camera, location, dispatch]);
  const userPanned = useCallback((coordinate: Coordinate) => {
    camera.userMoved(coordinate);
    location.cancel();
    const planner = plannerTask(getState());
    if (planner && !planner.origin.ready) dispatch({ type: 'pickOrigin' });
  }, [camera, location, getState, dispatch]);
  return { camera, location, locate, searchArea, userPanned };
}

export const [MapProvider, useMapContext] = createFeatureContext<MapModel>('Map');
