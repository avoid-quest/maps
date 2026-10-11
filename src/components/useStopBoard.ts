import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import type { DepartureBoard, TransitAlertSnapshot } from '../domain/types';
import { getDepartures, getTransitAlerts } from '../services/transit';
import { createActiveRefresh, REFRESH_INTERVALS, type ActiveRefresh } from './active-refresh';

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
  | { type: 'failure'; identity: string; error: string };
export function emptyResource<T>(identity = ''): RetainedResource<T> {
  return { identity, data: null, loading: false, error: '' };
}
export function retainedResourceReducer<T>(state: RetainedResource<T>, action: ResourceAction<T>): RetainedResource<T> {
  if (action.type === 'identity') return state.identity === action.identity ? state : emptyResource(action.identity);
  if (state.identity !== action.identity) return state;
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
  const [arrivals, updateArrivals] = useReducer(retainedResourceReducer<DepartureBoard>, emptyResource<DepartureBoard>());
  const [alerts, updateAlerts] = useReducer(retainedResourceReducer<TransitAlertSnapshot>, emptyResource<TransitAlertSnapshot>());
  const controllers = useRef<{ arrivals: ActiveRefresh; alerts: ActiveRefresh } | null>(null);
  const activity = useRef(active);
  activity.current = active;
  useLayoutEffect(() => {
    updateArrivals({ type: 'identity', identity });
    updateAlerts({ type: 'identity', identity });
    if (!identity) return;
    const next = {
      arrivals: createActiveRefresh({
        intervalMs: REFRESH_INTERVALS.arrivals,
        load: async signal => {
          const board = await getDepartures(identity, { signal });
          return { value: board, fetchedAt: board.fetchedAt };
        },
        onSuccess: data => updateArrivals({ type: 'success', identity, data }),
        onError: error => updateArrivals({ type: 'failure', identity,
          error: error instanceof Error ? error.message : 'Arrivi non disponibili.' }),
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
      for (const controller of Object.values(next)) controller.dispose();
      if (controllers.current === next) controllers.current = null;
    };
  }, [identity]);
  useLayoutEffect(() => {
    if (controllers.current) for (const controller of Object.values(controllers.current)) controller.setActive(active);
  }, [active, identity]);
  const suspend = useCallback(() => {
    if (controllers.current) for (const controller of Object.values(controllers.current)) controller.setActive(false);
  }, []);
  const refreshArrivals = useCallback(() => { controllers.current?.arrivals.refresh(); }, []);
  const refreshAlerts = useCallback(() => { controllers.current?.alerts.refresh(); }, []);
  const board = visibleResource(arrivals, identity);
  const notices = visibleResource(alerts, identity);
  return {
    board: board.data, alerts: notices.data,
    arrivalsLoading: board.loading, alertsLoading: notices.loading,
    arrivalsError: board.error, alertsError: notices.error,
    refreshArrivals, refreshAlerts, suspend,
  };
}
