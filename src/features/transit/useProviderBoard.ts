import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import type { TransitBoardSnapshot } from '../../domain/types';
import { createActiveRefresh, type ActiveRefresh } from '../app/active-refresh';
import { emptyResource, retainedResourceReducer, visibleResource } from './useStopBoard';

export interface ProviderBoardState {
  board: TransitBoardSnapshot | null;
  loading: boolean;
  error: string;
  refresh(): void;
}

/**
 * An explicitly requested online board (Transitous). It never polls: the first request follows the
 * user's action once `enabled`, later ones only the refresh control. The client's cache answers
 * refreshes inside its minimum interval with the same snapshot.
 */
export function useProviderBoard({ identity, enabled, active, load }: {
  /** Stop/station and event; a change discards the shown board. */
  identity: string;
  enabled: boolean;
  active: boolean;
  load: (signal: AbortSignal) => Promise<TransitBoardSnapshot>;
}): ProviderBoardState {
  const [state, update] = useReducer(retainedResourceReducer<TransitBoardSnapshot>, emptyResource<TransitBoardSnapshot>());
  const controller = useRef<ActiveRefresh | null>(null);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const activity = useRef(active);
  activity.current = active;
  const key = enabled ? identity : '';
  useLayoutEffect(() => {
    update({ type: 'identity', identity: key });
    if (!key) return;
    const next = createActiveRefresh<TransitBoardSnapshot>({
      intervalMs: null,
      load: async signal => { const board = await latestLoad.current(signal); return { value: board, fetchedAt: board.retrievedAt }; },
      onSuccess: board => update({ type: 'success', identity: key, data: board }),
      onError: error => update({ type: 'failure', identity: key, error: error instanceof Error ? error.message : 'Orari non disponibili.' }),
      onLoadingChange: loading => update({ type: 'loading', identity: key, loading }),
    });
    controller.current = next;
    next.setActive(activity.current);
    next.refresh();
    return () => { next.dispose(); if (controller.current === next) controller.current = null; };
  }, [key]);
  useLayoutEffect(() => { controller.current?.setActive(active); }, [active, key]);
  // A request interrupted by leaving the app is repeated on return, once; later ones stay manual.
  const hasData = !!visibleResource(state, key).data;
  useLayoutEffect(() => { if (active && key && !hasData) controller.current?.refresh(); }, [active, key, hasData]);
  const refresh = useCallback(() => { controller.current?.refresh(); }, []);
  const visible = visibleResource(state, key);
  return { board: key ? visible.data : null, loading: !!key && visible.loading, error: key ? visible.error : '', refresh };
}
