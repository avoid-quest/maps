import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';
import type { SearchPolicy, SearchResult } from '../../domain/types';
import { searchLocalResult, searchPlaces } from '../../services';
import { searchPreferences } from '../../services/search-preferences';
import { createFeatureContext } from '../app/feature-context';
import type { SheetState } from '../app/sheet';
import { rootTab, searchRoot } from '../app/task-model';
import type { TaskModel } from '../app/useTaskModel';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { MapCamera } from '../map/useMapCamera';

export interface Search {
  inputRef: RefObject<TextInput | null>;
  /** Typed text, owned here rather than by the task model. */
  query: string;
  category: string;
  /** Typed text, else the chosen category. */
  term: string;
  /** The term is long enough to show results. */
  hasSearch: boolean;
  result: SearchResult;
  policy: SearchPolicy;
  searching: boolean;
  error: string;
  focus(): void;
  changeQuery(value: string): void;
  chooseCategory(category: string): void;
  submit(): void;
  retry(): void;
  /** Clears typed text; closing the search task is a shell action. */
  clear(): void;
}

/** Local results immediately, then online results when the search policy allows them. */
export function useSearch({ tasks, camera, location, sheet, appActive, navigationVisible }: {
  tasks: TaskModel; camera: MapCamera; location: DeviceLocation; sheet: SheetState; appActive: boolean; navigationVisible: boolean;
}): Search {
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const category = searchRoot(tasks.state)?.category ?? '';
  const explore = rootTab(tasks.state) === 'explore';
  const term = query.trim() || category;
  const hasSearch = term.length >= 2;
  const searchCenter = camera.searchCenter;
  const preference = useSyncExternalStore(searchPreferences.subscribe, searchPreferences.getSnapshot, searchPreferences.getSnapshot);
  const policy: SearchPolicy = preference.ready && preference.preferenceKnown ? preference.policy : 'local-only';
  const localResult = useMemo(() => searchLocalResult(query.trim() || category, searchCenter), [query, category, searchCenter]);
  const [completed, setCompleted] = useState<{ result: SearchResult; policy: SearchPolicy; local: SearchResult } | null>(null);
  const result = completed?.policy === policy && completed.local === localResult ? completed.result : localResult;
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    if (!explore || navigationVisible || !hasSearch || !appActive) { setSearching(false); return; }
    const controller = new AbortController();
    // A switch change aborts now, without waiting for React's effect cleanup.
    const unsubscribe = searchPreferences.subscribe(() => {
      const current = searchPreferences.getSnapshot();
      if (!current.ready || !current.preferenceKnown || current.policy !== policy) controller.abort();
    });
    setError('');
    setCompleted({ result: localResult, policy, local: localResult });
    if (!preference.ready || policy === 'local-only') {
      setSearching(false);
      return () => { unsubscribe(); controller.abort(); };
    }
    setSearching(true);
    const timer = setTimeout(
      () => {
        searchPlaces(query.trim() || category, {
          center: searchCenter,
          signal: controller.signal,
          policy,
        })
          .then((next) => {
            if (!controller.signal.aborted) {
              setCompleted({ result: next, policy, local: localResult });
            }
          })
          .catch((failure) => {
            if (!controller.signal.aborted) {
              setError(failure instanceof Error ? failure.message : 'Ricerca non disponibile.');
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearching(false);
          });
      },
      query ? 450 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      unsubscribe();
    };
  }, [query, category, searchCenter, retryRevision, explore, preference.ready, policy, localResult, navigationVisible, hasSearch, appActive]);

  const { dispatch } = tasks;
  const focus = useCallback(() => {
    camera.touch();
    location.cancel();
    camera.searchHere();
    dispatch({ type: 'focusSearch' });
  }, [camera, location, dispatch]);
  const changeQuery = useCallback((value: string) => {
    location.cancel();
    camera.touch();
    sheet.collapse();
    setQuery(value);
    dispatch({ type: 'editQuery' });
  }, [camera, location, sheet, dispatch]);
  const chooseCategory = useCallback((next: string) => {
    Keyboard.dismiss();
    setQuery('');
    dispatch({ type: 'chooseCategory', category: next });
    camera.searchHere();
  }, [camera, dispatch]);
  const retry = useCallback(() => setRetryRevision(value => value + 1), []);
  const submit = useCallback(() => { Keyboard.dismiss(); retry(); }, [retry]);
  const clear = useCallback(() => setQuery(''), []);
  return { inputRef, query, category, term, hasSearch, result, policy, searching, error, focus, changeQuery, chooseCategory, submit, retry, clear };
}

export const [SearchProvider, useSearchContext] = createFeatureContext<Search>('Search');
