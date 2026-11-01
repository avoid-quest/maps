import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemePreferences, resolveColorScheme, THEME_PREFERENCE_KEY, themePreferenceOptions, type ThemePreference, type ThemePreferenceStorage } from './theme-preference';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  const writes: string[] = [];
  return {
    getItem: async (key: string) => { assert.equal(key, THEME_PREFERENCE_KEY); return value; },
    setItem: async (key: string, next: string) => { assert.equal(key, THEME_PREFERENCE_KEY); writes.push(next); value = next; },
    value: () => value,
    writes,
  };
}

test('preference resolves against the system scheme only when following the system', () => {
  assert.equal(resolveColorScheme('system', 'dark'), 'dark');
  assert.equal(resolveColorScheme('system', 'light'), 'light');
  for (const unknown of [null, undefined, 'unspecified']) assert.equal(resolveColorScheme('system', unknown), 'light');
  assert.equal(resolveColorScheme('dark', 'light'), 'dark');
  assert.equal(resolveColorScheme('light', 'dark'), 'light');
  assert.deepEqual(themePreferenceOptions, [{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }]);
});

test('startup follows the system while hydration is pending, then restores a saved choice', async () => {
  let resolve!: (value: string) => void;
  const storage = memoryStorage();
  const store = createThemePreferences();
  const initialized = store.initialize({ ...storage, getItem: () => new Promise<string>(done => { resolve = done; }) });
  assert.deepEqual(store.getSnapshot(), { ready: false, preferenceKnown: false, preference: 'system', storage: 'loading' });
  assert.equal(await store.setPreference('light'), false, 'A choice before hydration could be overwritten by the read');
  resolve(JSON.stringify({ version: 1, preference: 'dark' }));
  await initialized;
  assert.deepEqual(store.getSnapshot(), { ready: true, preferenceKnown: true, preference: 'dark', storage: 'local' });
  assert.equal(storage.writes.length, 0);
});

test('a missing preference means Sistema and is not written back', async () => {
  const storage = memoryStorage();
  const store = createThemePreferences();
  await store.initialize(storage);
  assert.equal(store.getSnapshot().preference, 'system');
  assert.equal(store.getSnapshot().preferenceKnown, true);
  assert.equal(storage.writes.length, 0);
  for (const preference of ['dark', 'light', 'system'] as const) {
    assert.equal(await store.setPreference(preference), true);
    const restored = createThemePreferences();
    await restored.initialize(storage);
    assert.equal(restored.getSnapshot().preference, preference);
  }
  assert.deepEqual(JSON.parse(storage.value()!), { version: 1, preference: 'system' });
});

test('malformed, unsupported and failed reads follow the system without overwriting the saved value', async () => {
  for (const raw of ['', '{', '{}', 'null', '"dark"', '{"version":2,"preference":"dark"}', '{"version":1,"preference":"sepia"}', '{"version":1}', 'x'.repeat(1025)]) {
    const storage = memoryStorage(raw);
    const store = createThemePreferences();
    await store.initialize(storage);
    assert.deepEqual(store.getSnapshot(), { ready: true, preferenceKnown: false, preference: 'system', storage: 'unavailable' }, raw.slice(0, 40));
    assert.equal(storage.value(), raw);
    assert.equal(storage.writes.length, 0);
    assert.equal(await store.setPreference('dark'), true);
    assert.equal(store.getSnapshot().preferenceKnown, true);
    assert.deepEqual(JSON.parse(storage.value()!), { version: 1, preference: 'dark' });
  }
  const storage = memoryStorage('{"version":1,"preference":"dark"}');
  const store = createThemePreferences();
  await store.initialize({ ...storage, getItem: async () => { throw new Error('unavailable'); } });
  assert.equal(store.getSnapshot().preference, 'system');
  assert.equal(store.getSnapshot().preferenceKnown, false);
  assert.equal(storage.writes.length, 0);
});

test('initialization is idempotent and invalid runtime values are rejected', async () => {
  const storage = memoryStorage('{"version":1,"preference":"light"}');
  const store = createThemePreferences();
  const first = store.initialize(storage);
  assert.equal(store.initialize(memoryStorage('{"version":1,"preference":"dark"}')), first);
  await first;
  assert.equal(store.getSnapshot().preference, 'light');
  assert.equal(await store.setPreference('sepia' as ThemePreference), false);
  assert.equal(store.getSnapshot().preference, 'light');
  assert.equal(storage.writes.length, 0);
});

test('observers repaint synchronously before a slow write', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const store = createThemePreferences();
  await store.initialize({ getItem: async () => null, setItem: async () => pending });
  const seen: ThemePreference[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().preference));
  const saved = store.setPreference('dark');
  assert.deepEqual(seen, ['dark']);
  finish();
  assert.equal(await saved, true);
  unsubscribe();
  await store.setPreference('light');
  assert.deepEqual(seen, ['dark', 'dark'], 'Unsubscribed listeners receive nothing further');
});

test('writes stay ordered and a failed write keeps the session choice', async () => {
  let persisted: string | null = null;
  const pending: { value: string; finish: () => void }[] = [];
  const storage: ThemePreferenceStorage = {
    getItem: async () => persisted,
    setItem: async (_key, value) => { await new Promise<void>(resolve => { pending.push({ value, finish: resolve }); }); persisted = value; },
  };
  const store = createThemePreferences();
  await store.initialize(storage);
  // Drain every queued microtask with a macrotask instead of assuming a promise-chain depth.
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  const first = store.setPreference('dark');
  const last = store.setPreference('light');
  await settle();
  assert.equal(pending.length, 1, 'The second write waits for the first');
  assert.equal(store.getSnapshot().preference, 'light');
  pending[0]!.finish();
  assert.equal(await first, true);
  assert.equal(JSON.parse(persisted!).preference, 'dark');
  await settle();
  assert.equal(pending.length, 2);
  pending[1]!.finish();
  assert.equal(await last, true);
  assert.equal(JSON.parse(persisted!).preference, 'light');

  const failed = createThemePreferences();
  await failed.initialize({ getItem: async () => null, setItem: async () => { throw new Error('full'); } });
  assert.equal(await failed.setPreference('dark'), false);
  assert.deepEqual(failed.getSnapshot(), { ready: true, preferenceKnown: true, preference: 'dark', storage: 'unavailable' });
  assert.equal(await failed.setPreference('light'), false, 'A failed write does not block later attempts');
});
