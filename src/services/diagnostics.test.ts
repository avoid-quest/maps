import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyDiagnosticReport, createDiagnosticReport, createDiagnostics, DIAGNOSTICS_KEY,
  MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_EVENTS, observeUnexpectedErrors,
  type DiagnosticInput, type DiagnosticSnapshot, type DiagnosticStorage,
} from './diagnostics';

const NOW = Date.UTC(2026, 9, 11, 12);
const PRIVATE = '12.345678,67.891234 home-secret search-personal token=sk_test_private';
function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: async (key: string) => { assert.equal(key, DIAGNOSTICS_KEY); return value; },
    setItem: async (key: string, next: string) => { assert.equal(key, DIAGNOSTICS_KEY); value = next; },
    value: () => value,
  };
}
const report = (snapshot: DiagnosticSnapshot) => createDiagnosticReport(snapshot, { version: '0.1.2', platform: 'android', build: 3, osVersion: 36 }, NOW);

test('ingest, persisted hydration and export rebuild only allowlisted fields', async () => {
  const injected = {
    at: NOW, type: 'request', state: 'network', provider: PRIVATE,
    durationMs: PRIVATE, httpStatus: PRIVATE, url: `https://example.test/?q=${PRIVATE}`,
    message: PRIVATE, coordinates: [12.345678, 67.891234], headers: { Authorization: PRIVATE },
  };
  const storage = memoryStorage(JSON.stringify({ version: 1, enabled: true, events: [injected, { ...injected, state: PRIVATE }] }));
  const store = createDiagnostics(() => NOW);
  await store.initialize(storage);
  store.record(injected as unknown as DiagnosticInput);
  store.record({ type: PRIVATE, state: PRIVATE } as unknown as DiagnosticInput);
  store.record({ ...injected, type: '__proto__' } as unknown as DiagnosticInput);
  await store.flush();
  assert.equal(store.getSnapshot().events.length, 2);
  assert.deepEqual(store.getSnapshot().events[0], { at: NOW, type: 'request', state: 'network', provider: 'other' });
  for (const text of [report(store.getSnapshot()), storage.value()!]) {
    for (const secret of [PRIVATE, '12.345678', '67.891234', 'Authorization', 'https://']) assert.ok(!text.includes(secret), secret);
  }
  const hostileSnapshot = { ...store.getSnapshot(), events: [injected] } as unknown as DiagnosticSnapshot;
  const exported = createDiagnosticReport(hostileSnapshot, { version: PRIVATE, build: PRIVATE, revision: PRIVATE, platform: PRIVATE, osVersion: PRIVATE, gttVersion: PRIVATE, gttValidTo: PRIVATE, placesRelease: PRIVATE }, NOW);
  assert.ok(!exported.includes(PRIVATE));
  assert.match(exported, /App: unknown/);
  assert.match(exported, /provider=other/);
});

test('ring persists only the newest 120 events within its byte budget, in insertion order', async () => {
  let at = NOW;
  const storage = memoryStorage();
  const store = createDiagnostics(() => at++);
  await store.initialize(storage);
  for (let index = 0; index < 160; index++) store.record({ type: 'request', state: 'ok', provider: 'photon', durationMs: index * 10, httpStatus: 200 });
  await store.flush();
  assert.equal(store.getSnapshot().events.length, MAX_DIAGNOSTIC_EVENTS);
  assert.equal(store.getSnapshot().events[0]?.at, NOW + 40);
  assert.equal(store.getSnapshot().events[119]?.at, NOW + 159);
  assert.ok(Buffer.byteLength(storage.value()!) <= MAX_DIAGNOSTIC_BYTES);
  const restored = createDiagnostics();
  await restored.initialize(storage);
  assert.deepEqual(restored.getSnapshot().events, store.getSnapshot().events);
  const text = report(restored.getSnapshot());
  assert.ok(text.indexOf('durationMs=400') < text.indexOf('durationMs=1590'));
});

test('clear follows pending writes so deleted events cannot reappear after restart', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let value: string | null = null;
  const storage: DiagnosticStorage = { getItem: async () => value, setItem: async (_key, next) => { await blocked; value = next; } };
  const store = createDiagnostics(() => NOW);
  await store.initialize(storage);
  store.record({ type: 'request', state: 'network', provider: 'photon' });
  const cleared = store.clear();
  store.record({ type: 'location', state: 'denied' });
  release();
  assert.equal(await cleared, true);
  await store.flush();
  const restored = createDiagnostics();
  await restored.initialize(storage);
  assert.deepEqual(restored.getSnapshot().events.map(event => event.type), ['location']);
  await restored.clear();
  assert.deepEqual(JSON.parse(value!).events, []);
});

test('disabled setting survives restart and drops events captured before hydration finishes', async () => {
  const storage = memoryStorage();
  const store = createDiagnostics(() => NOW);
  await store.initialize(storage);
  store.record({ type: 'app', state: 'launch' });
  await store.setEnabled(false);
  store.record({ type: 'location', state: 'requested' });
  const restored = createDiagnostics(() => NOW);
  restored.record({ type: 'app', state: 'launch' });
  await restored.initialize(storage);
  assert.equal(restored.getSnapshot().enabled, false);
  assert.equal(restored.getSnapshot().events.length, 1);
  await restored.clear();
  assert.equal(restored.getSnapshot().enabled, false);
  assert.equal(restored.getSnapshot().events.length, 0);
  await restored.setEnabled(true);
  restored.record({ type: 'app', state: 'active' });
  assert.equal(restored.getSnapshot().events.length, 1);
});

test('clear during a delayed read discards previously stored events', async () => {
  let read!: (value: string) => void;
  const loaded = new Promise<string>(resolve => { read = resolve; });
  const store = createDiagnostics(() => NOW);
  const storage = memoryStorage();
  const ready = store.initialize({ getItem: async () => loaded, setItem: storage.setItem });
  const clear = store.clear();
  read(JSON.stringify({ version: 1, enabled: true, events: [{ at: NOW, type: 'app', state: 'launch' }] }));
  await ready; await clear;
  assert.deepEqual(store.getSnapshot().events, []);
  assert.deepEqual(JSON.parse(storage.value()!).events, []);
});

test('malformed and oversized storage never becomes report text; storage failures stay visible', async () => {
  for (const initial of [PRIVATE, 'x'.repeat(MAX_DIAGNOSTIC_BYTES + 1)]) {
    const store = createDiagnostics(() => NOW);
    await store.initialize(memoryStorage(initial));
    assert.deepEqual(store.getSnapshot().events, []);
    assert.ok(!report(store.getSnapshot()).includes(PRIVATE));
  }
  const store = createDiagnostics(() => NOW);
  await store.initialize({ getItem: async () => { throw new Error(PRIVATE); }, setItem: async () => { throw new Error(PRIVATE); } });
  store.record({ type: 'app', state: 'launch' });
  await store.flush();
  assert.equal(store.getSnapshot().storage, 'unavailable');
  assert.equal(await store.clear(), false);
  assert.equal(await store.setEnabled(false), false);
  assert.ok(!report(store.getSnapshot()).includes(PRIVATE));
});

test('numeric fields are bounded; repeated map errors are coalesced but recovery remains visible', () => {
  let at = NOW;
  const store = createDiagnostics(() => at);
  store.record({ type: 'request', state: 'ok', provider: 'fossgis', durationMs: Infinity, httpStatus: 12.345678 });
  store.record({ type: 'request', state: 'ok', durationMs: 1e12, httpStatus: 9999 });
  store.record({ type: 'map', state: 'failed' });
  store.record({ type: 'map', state: 'failed' });
  store.record({ type: 'map', state: 'loaded' });
  at += 31_000;
  store.record({ type: 'map', state: 'loaded' });
  assert.equal(store.getSnapshot().events.length, 5);
  assert.equal(store.getSnapshot().events[0]?.durationMs, undefined);
  assert.equal(store.getSnapshot().events[0]?.httpStatus, undefined);
  assert.equal(store.getSnapshot().events[1]?.durationMs, 120_000);
});

test('copy exports exactly the preview and reports rejection or a false clipboard result', async () => {
  const store = createDiagnostics(() => NOW);
  const preview = report(store.getSnapshot());
  store.record({ type: 'app', state: 'active' });
  let copied = '';
  assert.equal(await copyDiagnosticReport(preview, async text => { copied = text; return true; }), 'copied');
  assert.equal(copied, preview);
  assert.equal(await copyDiagnosticReport(preview, async () => false), 'failed');
  assert.equal(await copyDiagnosticReport(preview, async () => { throw new Error(PRIVATE); }), 'failed');
});

test('unexpected JS errors log a fixed category and preserve the original fatal handler', () => {
  const store = createDiagnostics(() => NOW);
  const rawError = new Error(PRIVATE);
  let originalCalls = 0;
  const original = (error: Error, fatal?: boolean) => { assert.equal(error, rawError); assert.equal(fatal, true); originalCalls++; };
  let current = original;
  const hooks = { getGlobalHandler: () => current, setGlobalHandler: (handler: typeof original) => { current = handler; } };
  const restore = observeUnexpectedErrors(hooks, store.record);
  current(rawError, true);
  assert.equal(originalCalls, 1);
  assert.match(report(store.getSnapshot()), /app.runtime-error/);
  assert.ok(!report(store.getSnapshot()).includes(PRIVATE));
  restore();
  assert.equal(current, original);
  observeUnexpectedErrors(hooks, () => { throw new Error('storage failed'); });
  current(rawError, true);
  assert.equal(originalCalls, 2);
});
