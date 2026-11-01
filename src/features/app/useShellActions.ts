import { useCallback } from 'react';
import { Keyboard } from 'react-native';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';
import type { Search } from '../search/useSearch';
import { createFeatureContext } from './feature-context';
import type { SheetState } from './sheet';
import { hasTaskAboveRoot, topTask, type RootTab } from './task-model';
import type { TaskModel } from './useTaskModel';

export interface ShellActions {
  /** Starts a root task from the map, closing everything else. */
  openTab(tab: RootTab): void;
  /** Returns to the unselected map. */
  closeTask(): void;
  /** The sheet's back arrow. */
  closeTopTask(): void;
  toggleSettings(): void;
}

export function useShellController({ tasks, camera, location, sheet, search }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; sheet: SheetState; search: Search;
}): ShellActions {
  const { dispatch, getState } = tasks;
  const openTab = useCallback((tab: RootTab) => {
    camera.touch();
    sheet.collapse();
    if (tab === 'browse') search.clear();
    if (tab === 'transit') camera.searchHere();
    location.cancel();
    Keyboard.dismiss();
    dispatch({ type: 'openTab', tab });
  }, [camera, sheet, search, location, dispatch]);
  const closeTask = useCallback(() => {
    openTab('browse');
    search.inputRef.current?.blur();
  }, [openTab, search.inputRef]);
  const closeTopTask = useCallback(() => {
    const state = getState();
    if (!hasTaskAboveRoot(state)) { closeTask(); return; }
    if (topTask(state).kind === 'planner') location.cancel();
    dispatch({ type: 'closeTopTask' });
  }, [getState, closeTask, location, dispatch]);
  const toggleSettings = useCallback(() => {
    Keyboard.dismiss();
    dispatch({ type: 'toggleSettings' });
  }, [dispatch]);
  return { openTab, closeTask, closeTopTask, toggleSettings };
}

export const [ShellActionsProvider, useShellActions] = createFeatureContext<ShellActions>('ShellActions');
