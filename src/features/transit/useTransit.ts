import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { transitous } from '../../services/transitous-runtime';
import { transitousConsent, type TransitousConsentSnapshot } from '../../services/transitous-consent';
import { nearestRailPilotStations, type RailPilotStation } from '../../services/transitous-stations';
import type { RouteLeg, Stop } from '../../domain/types';
import { matchJourneyStop } from '../../services/transit-stop-matching';
import { getNearbyStops } from '../../services';
import { catalogVersion, subscribeCatalog } from '../../transit-data/stop-catalog';
import { savedTravel, type SavedTravelSnapshot } from '../../services/saved-travel';
import { createFeatureContext } from '../app/feature-context';
import type { SheetState } from '../app/sheet';
import { boardInFront, boardStop, selectedStation, type TaskState } from '../app/task-model';
import { useTaskTransitions, type TaskModel } from '../app/useTaskModel';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';
import type { NavigationModel } from '../navigation/useNavigation';
import { followBoarding } from '../navigation/transit-follow';
import { useProviderBoard, type ProviderBoardState } from './useProviderBoard';
import { useStopBoard } from './useStopBoard';

export interface Transit {
  /** Stops around the explicit search area. */
  nearbyStops: Stop[];
  /** The stop whose board is open, if any. */
  stop: Stop | null;
  board: ReturnType<typeof useStopBoard>;
  /**
   * The next boarding of a followed transit journey: its plan leg, the GTT stop it validates to
   * (strict matcher) and that stop's board, polled only while following is on screen.
   */
  follow: { leg: RouteLeg | null; stop: Stop | null; board: ReturnType<typeof useStopBoard> };
  /** Pilot rail stations near the search area, from the bundled mapping, computed on the device. */
  nearbyStations: (RailPilotStation & { distanceMeters: number })[];
  /** The open rail station board (Transitous), departures or arrivals. */
  rail: { station: RailPilotStation | null; event: 'departure' | 'arrival'; setEvent(event: 'departure' | 'arrival'): void; board: ProviderBoardState };
  /**
   * "Cerca su Transitous" for the open GTT stop: an explicit replacement of the board's online
   * source, never merged with GTT rows. While shown, GTT realtime requests for that board pause.
   */
  fallback: { stopId: string | null; open(): void; close(): void; board: ProviderBoardState };
  consent: TransitousConsentSnapshot;
  acceptTransitous(): void;
  openStation(station: RailPilotStation): void;
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

const catalogPackageHash = () => catalogVersion().packageHash;

export function useTransit({ tasks, camera, location, sheet, appActive, navigation }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; sheet: SheetState; appActive: boolean; navigation: NavigationModel;
}): Transit {
  const navigationVisible = navigation.visible;
  const searchCenter = camera.searchCenter;
  // Recomputed when the active timetable package (and so its stop catalog) changes.
  const catalogHash = useSyncExternalStore(subscribeCatalog, catalogPackageHash, catalogPackageHash);
  const nearbyStops = useMemo(() => { void catalogHash; return getNearbyStops(searchCenter, { limit: 15, radiusMeters: 1800 }); }, [searchCenter, catalogHash]);
  const nearbyStations = useMemo(() => nearestRailPilotStations(searchCenter, { radiusMeters: 3000, limit: 3 }), [searchCenter]);
  const stop = boardStop(tasks.state);
  const consent = useSyncExternalStore(transitousConsent.subscribe, transitousConsent.getSnapshot, transitousConsent.getSnapshot);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const fallbackStopId = stop && fallbackFor === stop.id ? stop.id : null;
  const board = useStopBoard({ stopId: stop?.id, active: !!stop && appActive && !navigationVisible && boardInFront(tasks.state) && !fallbackStopId });
  const fallbackBoard = useProviderBoard({
    identity: fallbackStopId ?? '', enabled: !!fallbackStopId && consent.accepted,
    active: !!fallbackStopId && appActive && !navigationVisible && boardInFront(tasks.state),
    load: signal => transitous.getGttStopFallbackBoard(stop!, { signal }),
  });
  const station = selectedStation(tasks.state);
  const [railEvent, setRailEvent] = useState<'departure' | 'arrival'>('departure');
  const railBoard = useProviderBoard({
    identity: station ? `${station.key}:${railEvent}` : '', enabled: !!station && consent.accepted,
    active: !!station && appActive && !navigationVisible,
    load: signal => transitous.getRailStationBoard(station!, { event: railEvent, signal }),
  });
  const following = followBoarding(navigation.snapshot, navigation.transitPlan);
  const followLeg = following?.leg ?? null;
  const followStop = useMemo(() => { void catalogHash; return followLeg ? matchJourneyStop(followLeg.fromStop) : null; }, [followLeg, catalogHash]);
  const followBoard = useStopBoard({ stopId: followStop?.id, active: !!followStop && appActive && navigationVisible && navigation.snapshot.mode === 'transit', alerts: false });
  const { suspend: suspendStopBoard } = board;
  const { suspend: suspendFollowBoard } = followBoard;
  // Lifecycle suspension stops both; task changes concern only the sheet's board.
  const suspend = useCallback(() => { suspendStopBoard(); suspendFollowBoard(); }, [suspendStopBoard, suspendFollowBoard]);
  // A board stops before React renders a different stop or a task in front of it.
  useTaskTransitions(tasks, (previous, next) => {
    const before = boardIdentity(previous);
    if (before && (before !== boardIdentity(next) || (boardInFront(previous) && !boardInFront(next)))) suspendStopBoard();
    // Another stop (or none) closes the Transitous replacement: each stop starts from GTT again.
    if (before && before !== boardIdentity(next)) setFallbackFor(null);
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
  const openStation = useCallback((next: RailPilotStation) => {
    location.cancel();
    camera.focus(next.coordinate);
    sheet.collapse();
    setRailEvent('departure');
    dispatch({ type: 'openStation', station: next });
  }, [camera, location, sheet, dispatch]);
  const fallback = useMemo(() => ({
    stopId: fallbackStopId, board: fallbackBoard,
    open: () => { if (stop) setFallbackFor(stop.id); },
    close: () => setFallbackFor(null),
  }), [fallbackStopId, fallbackBoard, stop]);
  const acceptTransitous = useCallback(() => { void transitousConsent.accept(); }, []);
  const openJourneyStop = useCallback((next: Stop) => {
    location.cancel();
    dispatch({ type: 'openJourneyStop', stop: next });
    camera.focus(next.coordinate);
    sheet.collapse();
  }, [camera, location, sheet, dispatch]);
  return {
    nearbyStops, stop, board, follow: { leg: followLeg, stop: followStop, board: followBoard },
    nearbyStations, rail: { station, event: railEvent, setEvent: setRailEvent, board: railBoard }, fallback, consent, acceptTransitous, openStation,
    savedTravel: snapshot, stopsBusy, isStopSaved, mutateSavedStops, openStop, openJourneyStop, suspend };
}

export const [TransitProvider, useTransitContext] = createFeatureContext<Transit>('Transit');
