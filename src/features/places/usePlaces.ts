import { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import type { Place } from '../../domain/types';
import { loadSavedPlaces, removeSavedPlace, savePlace } from '../../services';
import { createFeatureContext } from '../app/feature-context';
import type { AppFeedback } from '../app/feedback';
import type { SheetState } from '../app/sheet';
import type { TaskModel } from '../app/useTaskModel';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';

export interface Places {
  /** Places saved on this device. */
  saved: Place[];
  isSaved(id: string): boolean;
  toggleSaved(place: Place): Promise<void>;
  /** Shows a place's details and focuses it, replacing other detail tasks. */
  openPlace(place: Place): void;
}

export function usePlaces({ tasks, camera, location, sheet, feedback }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; sheet: SheetState; feedback: AppFeedback;
}): Places {
  const [saved, setSaved] = useState<Place[]>([]);
  const { report } = feedback;
  useEffect(() => {
    loadSavedPlaces()
      .then(setSaved)
      .catch(() => report('Impossibile leggere i luoghi salvati su questo dispositivo.'));
  }, [report]);
  const isSaved = useCallback((id: string) => saved.some(item => item.id === id), [saved]);
  const toggleSaved = useCallback(async (place: Place) => {
    try {
      setSaved(await (saved.some(item => item.id === place.id) ? removeSavedPlace(place.id) : savePlace(place)));
    } catch {
      report('Salvataggio non riuscito. Riprova.');
    }
  }, [saved, report]);
  const { dispatch } = tasks;
  const openPlace = useCallback((place: Place) => {
    // An explicit choice outranks a pending location fix.
    location.cancel();
    Keyboard.dismiss();
    camera.focus(place.coordinate);
    sheet.collapse();
    dispatch({ type: 'openPlace', place });
  }, [camera, location, sheet, dispatch]);
  return { saved, isSaved, toggleSaved, openPlace };
}

export const [PlacesProvider, usePlacesContext] = createFeatureContext<Places>('Places');
