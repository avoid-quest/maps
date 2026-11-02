import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, type ReactNode } from 'react';
import { savedTravel } from '../../services/saved-travel';
import { searchPreferences } from '../../services/search-preferences';
import { transitousConsent } from '../../services/transitous-consent';
import { useDeviceLocation } from '../map/useDeviceLocation';
import { useMapCamera } from '../map/useMapCamera';
import { MapProvider, useMapModel } from '../map/useMapModel';
import { NavigationProvider, useNavigation } from '../navigation/useNavigation';
import { PlacesProvider, usePlaces } from '../places/usePlaces';
import { PlannerProvider, usePlanner } from '../planner/usePlanner';
import { SearchProvider, useSearch } from '../search/useSearch';
import { TransitProvider, useTransit } from '../transit/useTransit';
import { FeedbackProvider, useAppFeedback } from './feedback';
import { SheetProvider, useSheetState } from './sheet';
import { detailKey } from './task-model';
import { useAndroidBack } from './useAndroidBack';
import { useAppActive } from './useAppActive';
import { ShellActionsProvider, useShellController } from './useShellActions';
import { TaskStateProvider, useTaskModel } from './useTaskModel';

/**
 * Composes the feature hooks in dependency order and exposes each through its own
 * context. Lifecycle suspension and Android Back are wired here, once.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const suspendActiveWork = useRef(() => {});
  const appActive = useAppActive(active => { if (!active) suspendActiveWork.current(); });
  const navigation = useNavigation(appActive);
  const tasks = useTaskModel();
  const sheet = useSheetState(detailKey(tasks.state));
  const feedback = useAppFeedback();
  const camera = useMapCamera();
  const location = useDeviceLocation({ tasks, camera, appActive, navigationVisible: navigation.visible });
  const map = useMapModel({ tasks, camera, location });
  const places = usePlaces({ tasks, camera, location, sheet, feedback });
  const search = useSearch({ tasks, camera, location, sheet, appActive, navigationVisible: navigation.visible });
  const transit = useTransit({ tasks, camera, location, sheet, appActive, navigation });
  const planner = usePlanner({ tasks, camera, location, places, navigation, sheet, appActive, suspendBoard: transit.suspend });
  const shell = useShellController({ tasks, camera, location, sheet, search });
  suspendActiveWork.current = () => { planner.suspend(); transit.suspend(); };
  useAndroidBack({ tasks, navigation, sheet, search, location });
  useEffect(() => {
    void searchPreferences.initialize(AsyncStorage);
    void savedTravel.initialize(AsyncStorage);
    void transitousConsent.initialize(AsyncStorage);
  }, []);
  return (
    <TaskStateProvider value={tasks.state}>
      <ShellActionsProvider value={shell}>
        <SheetProvider value={sheet}>
          <FeedbackProvider value={feedback}>
            <NavigationProvider value={navigation}>
              <MapProvider value={map}>
                <SearchProvider value={search}>
                  <PlacesProvider value={places}>
                    <TransitProvider value={transit}>
                      <PlannerProvider value={planner}>
                        {children}
                      </PlannerProvider>
                    </TransitProvider>
                  </PlacesProvider>
                </SearchProvider>
              </MapProvider>
            </NavigationProvider>
          </FeedbackProvider>
        </SheetProvider>
      </ShellActionsProvider>
    </TaskStateProvider>
  );
}
