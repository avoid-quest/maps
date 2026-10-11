import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Coordinate, TransitTime, TravelMode } from '../domain/types';
import { planRoutes } from '../services/routing';
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
  const sequence = useRef(0);
  const options = useMemo(() => to ? { from, to, mode, transitTime } : null, [from, to, mode, transitTime]);
  const queryKey = options && enabled ? routeQueryKey(options) : '';
  useEffect(() => {
    if (!options || !queryKey) return;
    const controller = new AbortController();
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
  const refreshPlans = useCallback(() => setRefresh(value => value + 1), []);
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  return {
    plans: visible.plans,
    route: visible.plans.find(plan => plan.id === visible.selectedId) ?? null,
    error: visible.error,
    loading: !!queryKey && (visible.loading || state.queryKey !== queryKey),
    refresh: refreshPlans,
    select,
    reset,
  };
}
