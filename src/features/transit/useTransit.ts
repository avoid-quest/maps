import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { Stop } from '../../domain/types';
import { getNearbyStops } from '../../services';
import { savedTravel, type SavedTravelSnapshot } from '../../services/saved-travel';
import { createFeatureContext } from '../app/feature-context';
import type { SheetState } from '../app/sheet';
import { boardInFront, boardStop, type TaskState } from '../app/task-model';
import { useTaskTransitions, type TaskModel } from '../app/useTaskModel';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';
import { useStopBoard } from './useStopBoard';

export interface Transit {
  /** Stops around the explicit search area. */
  nearbyStops: Stop[];
  /** The stop whose board is open, if any. */
  stop: Stop | null;
  board: ReturnType<typeof useStopBoard>;
  savedTravel: SavedTravelSnapshot;
  stopsBusy: boolean;
  isStopSaved(id: string): boolean;
  /** Runs one saved-stop change at a time. */
  mutateSavedStops(action: () => Promise<boolean>): Promise<void>;
  openStop(stop: Stop): void;
  /** Opens a journey's stop board above its planner. */
  openJourneyStop(stop: Stop): void;
  /** Stops board requests synchronously, before React renders. */
  suspend(): void;
}

function boardIdentity(state: TaskState): string | null {
  const stop = boardStop(state);
  return stop ? `${state.details[state.details.length - 1]?.kind}:${stop.id}` : null;
}

export function useTransit({ tasks, camera, location, sheet, appActive, navigationVisible }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; sheet: SheetState; appActive: boolean; navigationVisible: boolean;
}): Transit {
  const searchCenter = camera.searchCenter;
  const nearbyStops = useMemo(() => getNearbyStops(searchCenter, { limit: 15, radiusMeters: 1800 }), [searchCenter]);
  const stop = boardStop(tasks.state);
  const board = useStopBoard({ stopId: stop?.id, active: !!stop && appActive && !navigationVisible && boardInFront(tasks.state) });
  const { suspend } = board;
  // A board stops before React renders a different stop or a task in front of it.
  useTaskTransitions(tasks, (previous, next) => {
    const before = boardIdentity(previous);
    if (before && (before !== boardIdentity(next) || (boardInFront(previous) && !boardInFront(next)))) suspend();
  });
  const snapshot = useSyncExternalStore(savedTravel.subscribe, savedTravel.getSnapshot, savedTravel.getSnapshot);
  const [stopsBusy, setStopsBusy] = useState(false);
  const mutateSavedStops = useCallback(async (action: () => Promise<boolean>) => {
    if (stopsBusy) return;
    setStopsBusy(true);
    try { await action(); }
    finally { setStopsBusy(false); }
  }, [stopsBusy]);
  const isStopSaved = useCallback((id: string) => snapshot.stops.some(entry => entry.current?.id === id), [snapshot.stops]);
  const { dispatch } = tasks;
  const openStop = useCallback((next: Stop) => {
    location.cancel();
    camera.focus(next.coordinate);
    sheet.collapse();
    dispatch({ type: 'openStop', stop: next });
  }, [camera, location, sheet, dispatch]);
  const openJourneyStop = useCallback((next: Stop) => {
    location.cancel();
    dispatch({ type: 'openJourneyStop', stop: next });
    camera.focus(next.coordinate);
    sheet.collapse();
  }, [camera, location, sheet, dispatch]);
  return { nearbyStops, stop, board, savedTravel: snapshot, stopsBusy, isStopSaved, mutateSavedStops, openStop, openJourneyStop, suspend };
}

export const [TransitProvider, useTransitContext] = createFeatureContext<Transit>('Transit');
