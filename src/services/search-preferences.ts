import type { SearchPolicy } from '../domain/types';

export const SEARCH_PREFERENCES_KEY = '@avoid-maps/search-preferences-v1';
export interface SearchPreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface SearchPreferenceSnapshot {
  ready: boolean;
  preferenceKnown: boolean;
  policy: SearchPolicy;
  storage: 'loading' | 'local' | 'unavailable';
}

/** Online search stays disabled until the saved preference is understood. */
export function createSearchPreferences() {
  let snapshot: SearchPreferenceSnapshot = { ready: false, preferenceKnown: false, policy: 'local-only', storage: 'loading' };
  let storage: SearchPreferenceStorage | undefined;
  let initialization: Promise<void> | undefined;
  let writes = Promise.resolve(true);
  const listeners = new Set<() => void>();
  function update(next: Partial<SearchPreferenceSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize(target: SearchPreferenceStorage): Promise<void> {
      if (initialization) return initialization;
      storage = target;
      initialization = (async () => {
        try {
          const raw = await target.getItem(SEARCH_PREFERENCES_KEY);
          if (raw === null) {
            update({ ready: true, preferenceKnown: true, policy: 'local-and-online', storage: 'local' });
            return;
          }
          if (raw.length > 1024) throw new Error('Invalid search preference');
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('policy' in value) || (value.policy !== 'local-only' && value.policy !== 'local-and-online')) throw new Error('Invalid search preference');
          update({ ready: true, preferenceKnown: true, policy: value.policy, storage: 'local' });
        } catch {
          // Never replace an unreadable saved preference without an explicit choice.
          update({ ready: true, preferenceKnown: false, policy: 'local-only', storage: 'unavailable' });
        }
      })();
      return initialization;
    },
    setPolicy(policy: SearchPolicy): Promise<boolean> {
      if (!snapshot.ready || !storage) return Promise.resolve(false);
      const target = storage;
      // Notify synchronously: in-flight online requests are cancelled before persistence.
      update({ policy, preferenceKnown: true });
      writes = writes.then(async () => {
        try {
          await target.setItem(SEARCH_PREFERENCES_KEY, JSON.stringify({ version: 1, policy }));
          update({ storage: 'local' });
          return true;
        } catch {
          update({ storage: 'unavailable' });
          return false;
        }
      });
      return writes;
    },
  };
}

export const searchPreferences = createSearchPreferences();
