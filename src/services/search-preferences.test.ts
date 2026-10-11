import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPreferences, SEARCH_PREFERENCES_KEY, type SearchPreferenceStorage } from './search-preferences';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  const writes: string[] = [];
  return {
    getItem: async (key: string) => { assert.equal(key, SEARCH_PREFERENCES_KEY); return value; },
    setItem: async (key: string, next: string) => { assert.equal(key, SEARCH_PREFERENCES_KEY); writes.push(next); value = next; },
    value: () => value,
    writes,
  };
}
test('cold startup stays local while hydration is pending and restores a local-only choice', async () => {
  let resolve!: (value: string) => void;
  const storage = memoryStorage();
  const store = createSearchPreferences();
  const initialized = store.initialize({ ...storage, getItem: () => new Promise<string>(done => { resolve = done; }) });
  assert.equal(store.getSnapshot().ready, false);
  assert.equal(store.getSnapshot().policy, 'local-only');
  assert.equal(await store.setPolicy('local-and-online'), false);
  resolve(JSON.stringify({ version: 1, policy: 'local-only' }));
  await initialized;
  assert.equal(store.getSnapshot().policy, 'local-only');
  assert.equal(store.getSnapshot().preferenceKnown, true);
  assert.equal(storage.writes.length, 0);
});
test('only a proven missing preference uses the existing online default', async () => {
  const storage = memoryStorage();
  const store = createSearchPreferences();
  await store.initialize(storage);
  assert.equal(store.getSnapshot().policy, 'local-and-online');
  assert.equal(storage.writes.length, 0);
  await store.setPolicy('local-only');
  const restored = createSearchPreferences();
  await restored.initialize(storage);
  assert.equal(restored.getSnapshot().policy, 'local-only');
});
test('malformed, unsupported and failed reads stay closed without overwriting unknown preference', async () => {
  for (const raw of ['', '{', '{}', '{"version":2,"policy":"local-and-online"}', '{"version":1,"policy":true}', 'x'.repeat(1025)]) {
    const storage = memoryStorage(raw);
    const store = createSearchPreferences();
    await store.initialize(storage);
    assert.equal(store.getSnapshot().policy, 'local-only');
    assert.equal(store.getSnapshot().preferenceKnown, false);
    assert.equal(storage.value(), raw);
    assert.equal(storage.writes.length, 0);
    assert.equal(await store.setPolicy('local-only'), true);
    assert.equal(store.getSnapshot().preferenceKnown, true);
    assert.deepEqual(JSON.parse(storage.value()!), { version: 1, policy: 'local-only' });
  }
  const storage = memoryStorage('unreadable original');
  const store = createSearchPreferences();
  await store.initialize({ ...storage, getItem: async () => { throw new Error('unavailable'); } });
  assert.equal(store.getSnapshot().policy, 'local-only');
  assert.equal(store.getSnapshot().preferenceKnown, false);
  assert.equal(storage.writes.length, 0);
});
test('policy observers cancel online work synchronously before a slow disk write', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const store = createSearchPreferences();
  await store.initialize({ getItem: async () => null, setItem: async () => pending });
  const request = new AbortController();
  const unsubscribe = store.subscribe(() => { if (store.getSnapshot().policy === 'local-only') request.abort(); });
  const saved = store.setPolicy('local-only');
  assert.equal(request.signal.aborted, true);
  assert.equal(store.getSnapshot().policy, 'local-only');
  finish();
  assert.equal(await saved, true);
  unsubscribe();
});
test('writes remain ordered and failed persistence leaves the session choice active', async () => {
  let persisted: string | null = null;
  const pending: { value: string; finish: () => void }[] = [];
  const storage: SearchPreferenceStorage = {
    getItem: async key => { assert.equal(key, SEARCH_PREFERENCES_KEY); return persisted; },
    setItem: async (key, value) => {
      assert.equal(key, SEARCH_PREFERENCES_KEY);
      await new Promise<void>(resolve => { pending.push({ value, finish: resolve }); });
      persisted = value;
    },
  };
  const store = createSearchPreferences();
  await store.initialize(storage);
  const first = store.setPolicy('local-only');
  const second = store.setPolicy('local-and-online');
  const last = store.setPolicy('local-only');
  await Promise.resolve();
  assert.equal(pending.length, 1, 'Later writes must wait while the first write is pending');
  assert.equal(persisted, null);
  pending[0]!.finish();
  assert.equal(await first, true);
  assert.equal(pending.length, 2, 'The final write must wait while the second write is pending');
  assert.equal(JSON.parse(pending[1]!.value).policy, 'local-and-online');
  assert.equal(JSON.parse(persisted!).policy, 'local-only');
  pending[1]!.finish();
  assert.equal(await second, true);
  assert.equal(pending.length, 3);
  assert.equal(JSON.parse(persisted!).policy, 'local-and-online');
  pending[2]!.finish();
  assert.equal(await last, true);
  assert.equal(JSON.parse(persisted!).policy, 'local-only');
  const restored = createSearchPreferences();
  await restored.initialize(storage);
  assert.equal(restored.getSnapshot().policy, 'local-only');
  const broken: SearchPreferenceStorage = { getItem: async () => null, setItem: async () => { throw new Error('full'); } };
  const failed = createSearchPreferences();
  await failed.initialize(broken);
  assert.equal(await failed.setPolicy('local-only'), false);
  assert.equal(failed.getSnapshot().policy, 'local-only');
  assert.equal(failed.getSnapshot().storage, 'unavailable');
});
