import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Coordinate, TransitTime, TravelMode } from '../domain/types';
import { planRoutes } from '../services/routing';
import type { SavedJourneyInput } from '../services/saved-travel';
import { createActiveRefresh, REFRESH_INTERVALS, type ActiveRefresh } from './active-refresh';
import { emptyRouteState, routeQueryKey, routeReducer, selectedRoute, visibleRouteState } from './route-state';

export function useRoutePlans({ from, to, mode, transitTime, enabled, active }: {
  from: Coordinate;
  to?: Coordinate;
  mode: TravelMode;
  transitTime: TransitTime;
  enabled: boolean;
  active: boolean;
}) {
  const [state, dispatch] = useReducer(routeReducer, emptyRouteState);
  const [revision, setRevision] = useState(0);
  const restoredQuery = useRef<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<ActiveRefresh | null>(null);
  const activity = useRef(active);
  activity.current = active;
  // Coordinate object identity can change without changing a request's meaning.
  const fromLatitude = from.latitude; const fromLongitude = from.longitude;
  const toLatitude = to?.latitude; const toLongitude = to?.longitude;
  const options = useMemo(() => toLatitude !== undefined && toLongitude !== undefined ? {
    from: { latitude: fromLatitude, longitude: fromLongitude },
    to: { latitude: toLatitude, longitude: toLongitude }, mode, transitTime,
  } : null, [fromLatitude, fromLongitude, toLatitude, toLongitude, mode, transitTime]);
  // Activity pauses never hide data belonging to the current visible query.
  const queryKey = options && enabled ? routeQueryKey(options) : '';
  const latestOptions = useRef(options);
  latestOptions.current = options;
  useLayoutEffect(() => {
    const requestOptions = latestOptions.current;
    if (!requestOptions || !queryKey) return;
    let request = sequence.current;
    const next = createActiveRefresh({
      intervalMs: requestOptions.mode === 'transit' ? REFRESH_INTERVALS.transit : null,
      load: async signal => {
        request = ++sequence.current;
        dispatch({ type: 'start', queryKey, request });
        const plans = await planRoutes({ ...requestOptions, signal });
        return { value: plans, fetchedAt: plans[0]?.fetchedAt ?? Date.now() };
      },
      onSuccess: plans => dispatch({ type: 'success', queryKey, request, plans }),
      onError: error => dispatch({ type: 'failure', queryKey, request,
        error: error instanceof Error ? error.message : 'Percorso non disponibile.' }),
      onLoadingChange: loading => { if (!loading) dispatch({ type: 'settled', queryKey, request }); },
    });
    controller.current = next;
    next.setActive(activity.current);
    if (restoredQuery.current !== queryKey) {
      restoredQuery.current = null;
      next.refresh();
    }
    return () => {
      next.dispose();
      if (controller.current === next) controller.current = null;
    };
  }, [queryKey, revision]);
  useLayoutEffect(() => { controller.current?.setActive(active); }, [active, queryKey, revision]);
  const visible = visibleRouteState(state, queryKey);
  const refresh = useCallback(() => {
    restoredQuery.current = null;
    controller.current?.refresh();
  }, []);
  const suspend = useCallback(() => { controller.current?.setActive(false); }, []);
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const reset = useCallback(() => {
    controller.current?.dispose();
    controller.current = null;
    sequence.current += 1;
    restoredQuery.current = null;
    dispatch({ type: 'reset' });
    setRevision(value => value + 1);
  }, []);
  const restore = useCallback(({ query, plan }: SavedJourneyInput) => {
    controller.current?.dispose();
    controller.current = null;
    const queryKey = routeQueryKey(query);
    restoredQuery.current = queryKey;
    dispatch({ type: 'restore', queryKey, request: ++sequence.current, plan });
    setRevision(value => value + 1);
  }, []);
  return {
    plans: visible.plans,
    route: selectedRoute(visible),
    retainedSelection: visible.retainedSelection !== null,
    error: visible.error,
    loading: !!queryKey && active && (visible.loading || state.queryKey !== queryKey),
    refresh, select, reset, restore, suspend,
    saved: visible.saved,
    restoredViewId: visible.restoredViewId,
  };
}
