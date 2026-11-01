import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import type { TransitAlertSnapshot } from '../../domain/types';
import { ARRIVALS_REFRESH_MS, getScheduledBoard, getStopBoard, getTransitAlerts, RealtimeUnavailableError, updateSchedulesNow } from '../../services/transit';
import type { StopBoard } from '../../transit-data/board-model';
import { timetableService } from '../../transit-data/runtime';
import { createActiveRefresh, REFRESH_INTERVALS, type ActiveRefresh } from '../app/active-refresh';

export interface RetainedResource<T> {
  identity: string;
  data: T | null;
  loading: boolean;
  error: string;
}
type ResourceAction<T> =
  | { type: 'identity'; identity: string }
  | { type: 'loading'; identity: string; loading: boolean }
  | { type: 'success'; identity: string; data: T }
  /** Local scheduled rows: shown immediately, never replacing a newer realtime board. */
  | { type: 'placeholder'; identity: string; data: T }
  | { type: 'failure'; identity: string; error: string };
export function emptyResource<T>(identity = ''): RetainedResource<T> {
  return { identity, data: null, loading: false, error: '' };
}
export function retainedResourceReducer<T>(state: RetainedResource<T>, action: ResourceAction<T>): RetainedResource<T> {
  if (action.type === 'identity') return state.identity === action.identity ? state : emptyResource(action.identity);
  if (state.identity !== action.identity) return state;
  if (action.type === 'placeholder') return state.data ? state : { ...state, data: action.data };
  if (action.type === 'success') return { ...state, data: action.data, loading: false, error: '' };
  if (action.type === 'failure') return { ...state, loading: false, error: action.error };
  // Keep a failure visible until a successful response supersedes it.
  return { ...state, loading: action.loading };
}
export function visibleResource<T>(state: RetainedResource<T>, identity: string): RetainedResource<T> {
  return state.identity === identity ? state : emptyResource(identity);
}

export function useStopBoard({ stopId, active }: { stopId?: string; active: boolean }) {
  const identity = stopId ?? '';
  const [arrivals, updateArrivals] = useReducer(retainedResourceReducer<StopBoard>, emptyResource<StopBoard>());
  const [alerts, updateAlerts] = useReducer(retainedResourceReducer<TransitAlertSnapshot>, emptyResource<TransitAlertSnapshot>());
  const schedules = useSyncExternalStore(timetableService.subscribe, timetableService.status, timetableService.status);
  const controllers = useRef<{ arrivals: ActiveRefresh; alerts: ActiveRefresh } | null>(null);
  const activity = useRef(active);
  activity.current = active;
  useLayoutEffect(() => {
    updateArrivals({ type: 'identity', identity });
    updateAlerts({ type: 'identity', identity });
    if (!identity) return;
    const scheduled = new AbortController();
    // Scheduled-first: the local timetable renders before any network request completes.
    void getScheduledBoard(identity, { signal: scheduled.signal })
      .then(data => { if (!scheduled.signal.aborted) updateArrivals({ type: 'placeholder', identity, data }); })
      .catch(() => undefined);
    const next = {
      arrivals: createActiveRefresh({
        intervalMs: ARRIVALS_REFRESH_MS,
        load: async signal => {
          const board = await getStopBoard(identity, { signal });
          return { value: board, fetchedAt: board.realtime.retrievedAt ?? board.generatedAt };
        },
        onSuccess: data => updateArrivals({ type: 'success', identity, data }),
        onError: error => {
          // Realtime failed: keep fresh scheduled rows while the controller backs off.
          if (error instanceof RealtimeUnavailableError) updateArrivals({ type: 'success', identity, data: error.board });
          updateArrivals({ type: 'failure', identity, error: error instanceof Error ? error.message : 'Arrivi non disponibili.' });
        },
        onLoadingChange: loading => updateArrivals({ type: 'loading', identity, loading }),
      }),
      alerts: createActiveRefresh({
        intervalMs: REFRESH_INTERVALS.alerts,
        load: async signal => {
          const snapshot = await getTransitAlerts(identity, { signal });
          return { value: snapshot, fetchedAt: snapshot.fetchedAt };
        },
        onSuccess: data => updateAlerts({ type: 'success', identity, data }),
        onError: () => updateAlerts({ type: 'failure', identity, error: 'Avvisi di servizio non disponibili.' }),
        onLoadingChange: loading => updateAlerts({ type: 'loading', identity, loading }),
      }),
    };
    controllers.current = next;
    for (const controller of Object.values(next)) {
      controller.setActive(activity.current);
      controller.refresh();
    }
    return () => {
      scheduled.abort();
      for (const controller of Object.values(next)) controller.dispose();
      if (controllers.current === next) controllers.current = null;
    };
  }, [identity]);
  useLayoutEffect(() => {
    if (controllers.current) for (const controller of Object.values(controllers.current)) controller.setActive(active);
  }, [active, identity]);
  // Opening or resuming a board checks the schedule manifest when the last success is over 6 h old.
  useEffect(() => { if (active && identity) void timetableService.check('open'); }, [active, identity]);
  // A newly activated package re-renders the board from its own stops and trips.
  const packageHash = schedules.meta?.packageHash;
  const shownHash = useRef(packageHash);
  useEffect(() => {
    if (shownHash.current === packageHash) return;
    shownHash.current = packageHash;
    controllers.current?.arrivals.refresh();
  }, [packageHash]);
  const suspend = useCallback(() => {
    if (controllers.current) for (const controller of Object.values(controllers.current)) controller.setActive(false);
  }, []);
  const refreshArrivals = useCallback(() => { controllers.current?.arrivals.refresh(); }, []);
  const refreshAlerts = useCallback(() => { controllers.current?.alerts.refresh(); }, []);
  const updateSchedules = useCallback(() => { updateSchedulesNow(); }, []);
  const setSchedulesWifiOnly = useCallback((value: boolean) => { void timetableService.setWifiOnly(value); }, []);
  const setStopLive = useCallback((value: boolean) => {
    void timetableService.setStopLive(value).then(() => controllers.current?.arrivals.refresh());
  }, []);
  const board = visibleResource(arrivals, identity);
  const notices = visibleResource(alerts, identity);
  return {
    board: board.data, alerts: notices.data,
    arrivalsLoading: board.loading, alertsLoading: notices.loading,
    arrivalsError: board.error, alertsError: notices.error,
    refreshArrivals, refreshAlerts, suspend,
    schedules, updateSchedules, setSchedulesWifiOnly, setStopLive,
  };
}
