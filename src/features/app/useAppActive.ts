import { useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { subscribeAppActive } from './app-active';

/** Suspend request controllers in onActiveChange(false), before React updates the view. */
export function useAppActive(onActiveChange?: (active: boolean) => void): boolean {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  const callback = useRef(onActiveChange);
  useLayoutEffect(() => { callback.current = onActiveChange; });
  useLayoutEffect(() => subscribeAppActive(AppState, next => {
    callback.current?.(next);
    setActive(next);
  }), []);
  return active;
}
