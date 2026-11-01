import type { ColorScheme } from './palette';

export type ThemePreference = 'system' | ColorScheme;
export const THEME_PREFERENCE_KEY = '@avoid-maps/theme-preference-v1';
export const themePreferenceOptions: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Chiaro' },
  { value: 'dark', label: 'Scuro' },
];

export interface ThemePreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface ThemePreferenceSnapshot {
  ready: boolean;
  /** False after an unreadable saved value; the stored value is kept until the user chooses again. */
  preferenceKnown: boolean;
  preference: ThemePreference;
  storage: 'loading' | 'local' | 'unavailable';
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Resolve the appearance to render. An unknown system scheme (web, old Android) renders light. */
export function resolveColorScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

/** Appearance follows the system until a saved choice is read. Failures never overwrite the saved value. */
export function createThemePreferences() {
  let snapshot: ThemePreferenceSnapshot = { ready: false, preferenceKnown: false, preference: 'system', storage: 'loading' };
  let storage: ThemePreferenceStorage | undefined;
  let initialization: Promise<void> | undefined;
  let writes = Promise.resolve(true);
  const listeners = new Set<() => void>();
  function update(next: Partial<ThemePreferenceSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize(target: ThemePreferenceStorage): Promise<void> {
      if (initialization) return initialization;
      storage = target;
      initialization = (async () => {
        try {
          const raw = await target.getItem(THEME_PREFERENCE_KEY);
          if (raw === null) {
            update({ ready: true, preferenceKnown: true, preference: 'system', storage: 'local' });
            return;
          }
          if (raw.length > 1024) throw new Error('Invalid theme preference');
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('preference' in value) || !isThemePreference(value.preference)) throw new Error('Invalid theme preference');
          update({ ready: true, preferenceKnown: true, preference: value.preference, storage: 'local' });
        } catch {
          update({ ready: true, preferenceKnown: false, preference: 'system', storage: 'unavailable' });
        }
      })();
      return initialization;
    },
    setPreference(preference: ThemePreference): Promise<boolean> {
      if (!snapshot.ready || !storage || !isThemePreference(preference)) return Promise.resolve(false);
      const target = storage;
      // Repaint immediately; persistence follows in order.
      update({ preference, preferenceKnown: true });
      writes = writes.then(async () => {
        try {
          await target.setItem(THEME_PREFERENCE_KEY, JSON.stringify({ version: 1, preference }));
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

export type ThemePreferenceStore = ReturnType<typeof createThemePreferences>;
export const themePreferences = createThemePreferences();
