/**
 * Framing intent for search results. Submitting a search or choosing a category requests one frame;
 * editing or clearing the query cancels it; only the search run that started after the request can
 * settle it, so the map never frames results from before the submission (or local-only results while
 * the online request is still pending). Revisions only grow, so a consumed frame is never replayed.
 */
export interface SearchFrameState { lastRevision: number; pending: { revision: number; settled: boolean } | null }
export type SearchFrameAction = { type: 'request' } | { type: 'cancel' } | { type: 'settled'; revision: number };

export const initialSearchFrame: SearchFrameState = { lastRevision: 0, pending: null };

export function searchFrameReducer(state: SearchFrameState, action: SearchFrameAction): SearchFrameState {
  switch (action.type) {
    case 'request': {
      const revision = state.lastRevision + 1;
      return { lastRevision: revision, pending: { revision, settled: false } };
    }
    case 'cancel':
      return state.pending ? { ...state, pending: null } : state;
    case 'settled':
      return state.pending && state.pending.revision === action.revision && !state.pending.settled
        ? { ...state, pending: { ...state.pending, settled: true } } : state;
  }
}
