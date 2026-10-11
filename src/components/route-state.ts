import type { RoutePlan } from '../domain/types';
import type { PlanRouteOptions } from '../services/routing';

export interface RouteState {
  queryKey: string;
  request: number;
  plans: RoutePlan[];
  selectedId: string | null;
  loading: boolean;
  error: string;
  saved: boolean;
}
export const emptyRouteState: RouteState = {
  queryKey: '', request: 0, plans: [], selectedId: null, loading: false, error: '', saved: false,
};
type RouteAction =
  | { type: 'start'; queryKey: string; request: number }
  | { type: 'success'; queryKey: string; request: number; plans: RoutePlan[] }
  | { type: 'failure'; queryKey: string; request: number; error: string }
  | { type: 'select'; id: string }
  | { type: 'restore'; queryKey: string; request: number; plan: RoutePlan }
  | { type: 'reset' };

export function routeQueryKey({ from, to, mode, transitTime }: PlanRouteOptions): string {
  const time = mode === 'transit' && transitTime?.kind !== 'now' ? transitTime : undefined;
  return JSON.stringify([from.latitude, from.longitude, to.latitude, to.longitude, mode,
    time?.kind ?? 'now', time && 'date' in time ? time.date : '', time && 'time' in time ? time.time : '']);
}

export function routeReducer(state: RouteState, action: RouteAction): RouteState {
  if (action.type === 'reset') return emptyRouteState;
  if (action.type === 'restore') return {
    queryKey: action.queryKey, request: action.request, plans: [action.plan],
    selectedId: action.plan.id, loading: false, error: '', saved: true,
  };
  if (action.type === 'select') return state.plans.some(plan => plan.id === action.id)
    ? { ...state, selectedId: action.id } : state;
  if (action.type === 'start') return {
    ...(state.queryKey === action.queryKey ? state : emptyRouteState),
    queryKey: action.queryKey, request: action.request, loading: true, error: '',
  };
  if (action.queryKey !== state.queryKey || action.request !== state.request) return state;
  if (action.type === 'failure') return { ...state, loading: false, error: action.error };
  return {
    ...state, plans: action.plans, loading: false, error: '', saved: false,
    selectedId: action.plans.some(plan => plan.id === state.selectedId)
      ? state.selectedId : action.plans[0]?.id ?? null,
  };
}

/** Hide a previous query immediately, including the render before effects run. */
export function visibleRouteState(state: RouteState, queryKey: string): RouteState {
  return state.queryKey === queryKey ? state : emptyRouteState;
}
