import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Coordinate, TransitTime, TravelMode } from '../domain/types';
import { planRoutes } from '../services/routing';
import type { SavedJourneyInput } from '../services/saved-travel';
import { emptyRouteState, routeQueryKey, routeReducer, visibleRouteState } from './route-state';

export function useRoutePlans({ from, to, mode, transitTime, enabled }: {
  from: Coordinate;
  to?: Coordinate;
  mode: TravelMode;
  transitTime: TransitTime;
  enabled: boolean;
}) {
  const [state, dispatch] = useReducer(routeReducer, emptyRouteState);
  const [refresh, setRefresh] = useState(0);
  const restoredQuery = useRef<string | null>(null);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const options = useMemo(() => to ? { from, to, mode, transitTime } : null, [from, to, mode, transitTime]);
  const queryKey = options && enabled ? routeQueryKey(options) : '';
  useEffect(() => {
    if (!options || !queryKey || restoredQuery.current === queryKey) return;
    restoredQuery.current = null;
    const controller = new AbortController();
    activeRequest.current = controller;
    const request = ++sequence.current;
    dispatch({ type: 'start', queryKey, request });
    planRoutes({ ...options, signal: controller.signal }).then(plans => {
      if (!controller.signal.aborted) dispatch({ type: 'success', queryKey, request, plans });
    }).catch(error => {
      if (!controller.signal.aborted) dispatch({
        type: 'failure', queryKey, request,
        error: error instanceof Error ? error.message : 'Percorso non disponibile.',
      });
    });
    return () => controller.abort();
  }, [options, queryKey, refresh]);
  const visible = visibleRouteState(state, queryKey);
  const refreshPlans = useCallback(() => {
    restoredQuery.current = null;
    setRefresh(value => value + 1);
  }, []);
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const reset = useCallback(() => {
    activeRequest.current?.abort();
    sequence.current += 1;
    restoredQuery.current = null;
    dispatch({ type: 'reset' });
  }, []);
  const restore = useCallback(({ query, plan }: SavedJourneyInput) => {
    activeRequest.current?.abort();
    const queryKey = routeQueryKey(query);
    restoredQuery.current = queryKey;
    setRefresh(value => value + 1);
    dispatch({ type: 'restore', queryKey, request: ++sequence.current, plan });
  }, []);
  return {
    plans: visible.plans,
    route: visible.plans.find(plan => plan.id === visible.selectedId) ?? null,
    error: visible.error,
    loading: !!queryKey && (visible.loading || state.queryKey !== queryKey),
    refresh: refreshPlans,
    select,
    reset,
    restore,
    saved: visible.saved,
    restoredViewId: visible.restoredViewId,
  };
}
