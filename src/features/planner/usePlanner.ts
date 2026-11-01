import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Keyboard } from 'react-native';
import type { Coordinate, Place, TransitTime, TravelMode } from '../../domain/types';
import { navigationLocationForReplan } from '../../domain/navigation';
import { savedTravel, type SavedJourney, type SavedTravelSnapshot } from '../../services/saved-travel';
import { createFeatureContext } from '../app/feature-context';
import type { SheetState } from '../app/sheet';
import { plannerInFront, plannerTask, type PlannerTask, type TaskState } from '../app/task-model';
import { useTaskTransitions, type TaskModel } from '../app/useTaskModel';
import { INITIAL_MAP } from '../map/coordinates';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';
import type { NavigationModel } from '../navigation/useNavigation';
import type { Places } from '../places/usePlaces';
import { savedTravelFailureMessage } from '../transit/SavedTravelPanel';
import { routeQueryKey } from './route-state';
import { useRoutePlans } from './useRoutePlans';

export interface Planner {
  /** The open planning task, including its origin step. */
  task: PlannerTask | null;
  mode: TravelMode;
  transitTime: TransitTime;
  routes: ReturnType<typeof useRoutePlans>;
  /** The displayed journey is the saved copy. */
  savedJourneyVisible: boolean;
  journeyBusy: boolean;
  journeySaveError: string | null;
  savedTravel: SavedTravelSnapshot;
  /** Identifies a requested planning frame; refreshes keep the same key. */
  fitKey: string | undefined;
  beginRoute(destination?: Place, mode?: TravelMode): Promise<void>;
  pickOriginOnMap(): void;
  /** Uses a map tap as origin while picking. */
  chooseOrigin(coordinate: Coordinate): void;
  cancelOriginPicking(): void;
  setMode(mode: TravelMode): void;
  submitTransitTime(value: TransitTime): void;
  selectJourney(id: string): void;
  saveJourney(): Promise<void>;
  clearJourney(): Promise<void>;
  restoreJourney(journey: SavedJourney): void;
  /** Hands the selected preview to native guidance. */
  startGuidance(): void;
  /** Stops transit guidance and plans again from its last accepted position. */
  replanFromNavigation(): Promise<void>;
  /** Stops route requests synchronously, before React renders. */
  suspend(): void;
}

function plannerQuery(state: TaskState): string | null {
  const planner = plannerTask(state);
  return planner?.origin.ready
    ? routeQueryKey({ from: planner.origin.coordinate, to: planner.destination.coordinate, ...state.travel }) : null;
}

export function usePlanner({ tasks, camera, location, places, navigation, sheet, appActive, suspendBoard }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; places: Places; navigation: NavigationModel;
  sheet: SheetState; appActive: boolean; suspendBoard: () => void;
}): Planner {
  const task = plannerTask(tasks.state);
  const { mode, transitTime } = tasks.state.travel;
  const routes = useRoutePlans({
    from: task?.origin.coordinate ?? INITIAL_MAP,
    to: task?.destination.coordinate,
    mode,
    transitTime,
    enabled: !!task?.origin.ready,
    active: plannerInFront(tasks.state) && appActive && !location.locating && !navigation.visible,
  });
  const { reset, suspend, refresh, select, restore } = routes;
  // A closed or replaced planner discards its plans; one moved behind another task pauses.
  useTaskTransitions(tasks, (previous, next) => {
    const before = plannerTask(previous);
    if (!before) return;
    if (before.session !== plannerTask(next)?.session) { reset(); return; }
    if (plannerInFront(previous) && (!plannerInFront(next) || plannerQuery(previous) !== plannerQuery(next))) suspend();
  });

  const travel = useSyncExternalStore(savedTravel.subscribe, savedTravel.getSnapshot, savedTravel.getSnapshot);
  const { dispatch, getState } = tasks;
  const { cancel: cancelLocation } = location;
  useEffect(() => {
    // Removing the saved journey closes the view restored from it.
    if (routes.restoredViewId !== null && travel.journeyStatus === 'ready' && !travel.journey) {
      cancelLocation();
      dispatch({ type: 'closeDetails' });
    }
  }, [routes.restoredViewId, travel.journeyStatus, travel.journey, cancelLocation, dispatch]);

  const route = routes.route;
  const query = task ? { from: task.origin.coordinate, to: task.destination.coordinate, mode, transitTime } : null;
  const savedJourneyVisible = !!route && (routes.saved || (!!travel.journey && !!query
    && travel.journey.plan.id === route.id && travel.journey.plan.fetchedAt === route.fetchedAt
    && routeQueryKey(travel.journey.query) === routeQueryKey(query)));
  const fitKey = query && task?.origin.ready ? `${routeQueryKey(query)}:${camera.frameRevision}` : undefined;

  const [journeyBusy, setJourneyBusy] = useState(false);
  const saveJourney = useCallback(async () => {
    if (!route || !task || journeyBusy || routes.retainedSelection) return;
    setJourneyBusy(true);
    try {
      await savedTravel.saveJourney({
        query: { from: task.origin.coordinate, to: task.destination.coordinate, mode, transitTime },
        originLabel: task.origin.label, destinationLabel: task.destination.name, plan: route,
      });
    } finally { setJourneyBusy(false); }
  }, [route, task, journeyBusy, routes.retainedSelection, mode, transitTime]);
  const clearJourney = useCallback(async () => {
    if (journeyBusy) return;
    setJourneyBusy(true);
    try { await savedTravel.clearJourney(); }
    finally { setJourneyBusy(false); }
  }, [journeyBusy]);

  const { openPlace } = places;
  const beginRoute = useCallback(async (destination?: Place, travelMode?: TravelMode) => {
    if (destination) openPlace(destination);
    const hasFix = location.coordinate !== null;
    // Any earlier request must not settle this planner's origin.
    if (!hasFix) location.cancel();
    dispatch({ type: 'beginRoute', destination, mode: travelMode, viewport: camera.viewport(), locating: hasFix });
    if (!hasFix) return;
    const outcome = await location.acquire();
    if (!outcome) return;
    if ('coordinate' in outcome) dispatch({ type: 'originLocated', coordinate: outcome.coordinate });
    else {
      dispatch({ type: 'originLocateFailed' });
      location.setMessage('Posizione non aggiornata. Riprova oppure scegli il punto di partenza sulla mappa.');
    }
  }, [openPlace, location, camera, dispatch]);
  const pickOriginOnMap = useCallback(() => {
    location.cancel();
    dispatch({ type: 'pickOrigin' });
    sheet.collapse();
  }, [location, sheet, dispatch]);
  const chooseOrigin = useCallback((coordinate: Coordinate) => {
    if (plannerTask(getState())?.originStep !== 'picking') return;
    location.cancel();
    dispatch({ type: 'setOrigin', coordinate });
  }, [location, getState, dispatch]);
  const cancelOriginPicking = useCallback(() => dispatch({ type: 'cancelOriginPicking' }), [dispatch]);
  const setMode = useCallback((next: TravelMode) => dispatch({ type: 'setTravelMode', mode: next }), [dispatch]);
  const submitTransitTime = useCallback((value: TransitTime) => {
    if (JSON.stringify(value) === JSON.stringify(getState().travel.transitTime)) refresh();
    else dispatch({ type: 'setTransitTime', transitTime: value });
  }, [getState, refresh, dispatch]);
  const selectJourney = useCallback((id: string) => { select(id); camera.frameRoute(); }, [select, camera]);
  const restoreJourney = useCallback((journey: SavedJourney) => {
    location.cancel();
    Keyboard.dismiss();
    dispatch({
      type: 'restoreJourney',
      destination: {
        id: 'saved-journey-destination', name: journey.destinationLabel,
        coordinate: journey.query.to, source: journey.plan.source,
        attributions: ['Dati © OpenStreetMap contributors'],
      },
      origin: { coordinate: journey.query.from, label: journey.originLabel },
      travel: { mode: journey.query.mode, transitTime: journey.query.transitTime },
    });
    camera.focus(journey.query.to);
    sheet.collapse();
    restore(journey);
  }, [location, camera, sheet, restore, dispatch]);
  const startGuidance = useCallback(() => {
    if (!route || routes.retainedSelection || !task) return;
    location.cancel(); suspend(); suspendBoard(); camera.follow();
    if (mode === 'transit') void navigation.startTransit({ plan: route, origin: task.origin.coordinate, destination: task.destination.coordinate });
    else void navigation.start({ destination: task.destination.coordinate, mode });
  }, [route, routes.retainedSelection, task, location, suspend, suspendBoard, camera, mode, navigation]);
  const replanFromNavigation = useCallback(async () => {
    const current = navigation.snapshot;
    location.cancel();
    suspend(); suspendBoard();
    // Keep preview requests suspended while Stop settles and the new origin is chosen.
    dispatch({ type: 'pickOrigin' });
    if (!await navigation.stop()) return;
    const from = navigationLocationForReplan(current);
    if (from) {
      location.accept(from);
      camera.moveTo(from);
    }
    dispatch({
      type: 'replan', from: from ?? undefined, viewport: camera.viewport(),
      destination: current.destination
        ? { id: 'navigation-destination', name: 'Destinazione del viaggio', coordinate: current.destination, source: 'MATO / 5T', attributions: [] }
        : undefined,
    });
  }, [navigation, location, suspend, suspendBoard, camera, dispatch]);

  return {
    task, mode, transitTime, routes, savedJourneyVisible, journeyBusy,
    journeySaveError: savedTravelFailureMessage(travel.journeyFailure), savedTravel: travel, fitKey,
    beginRoute, pickOriginOnMap, chooseOrigin, cancelOriginPicking, setMode, submitTransitTime, selectJourney,
    saveJourney, clearJourney, restoreJourney, startGuidance, replanFromNavigation, suspend,
  };
}

export const [PlannerProvider, usePlannerContext] = createFeatureContext<Planner>('Planner');
