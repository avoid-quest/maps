import type { AppStateStatus } from 'react-native';

interface AppActivitySource {
  readonly currentState: AppStateStatus | null;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void } | undefined;
}

/** Uses the same AppState contract on native and web; callbacks run in the event handler. */
export function subscribeAppActive(source: AppActivitySource, onActiveChange: (active: boolean) => void): () => void {
  const subscription = source.addEventListener('change', state => onActiveChange(state === 'active'));
  // Reconcile a transition between render and subscription before request effects run.
  onActiveChange(source.currentState === 'active');
  return () => subscription?.remove();
}
