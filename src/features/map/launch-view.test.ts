import test from 'node:test';
import assert from 'node:assert/strict';
import { TURIN_OVERVIEW } from './coordinates';
import { createRecenterIntent } from './recenter-intent';
import { createViewportStore, parseViewport, serializeViewport, VIEWPORT_KEY } from './viewport-store';

test('Locate centres on the first fix even when the permission dialog suspended the request', () => {
  const intent = createRecenterIntent();
  intent.request();
  // The dialog backgrounds the app: the explicit request is superseded, the intent is not.
  assert.equal(intent.pending, true);
  assert.equal(intent.take(), 'center', 'the foreground fix after granting permission centres the camera');
  assert.equal(intent.take(), 'adopt', 'only the first fix is consumed');
});

test('a user choice or a failed request withdraws the pending centre', () => {
  const intent = createRecenterIntent();
  intent.request(); intent.withdraw();
  assert.equal(intent.take(), 'adopt', 'a pan after Locate wins over a late fix');
  intent.request(); intent.failed();
  assert.equal(intent.take(), 'adopt');
  assert.equal(createRecenterIntent().take(), 'adopt', 'a launch fix without Locate only adopts an untouched camera');
});

test('the stored viewport is rounded, bounded and validated', () => {
  const raw = serializeViewport({ latitude: 45.070312, longitude: 7.686949 }, 15.37);
  assert.deepEqual(JSON.parse(raw!), { version: 1, latitude: 45.07, longitude: 7.687, zoom: 15.4 });
  assert.deepEqual(parseViewport(raw), { center: { latitude: 45.07, longitude: 7.687 }, zoom: 15.4 });
  assert.equal(JSON.parse(serializeViewport({ latitude: 45, longitude: 7 }, 21)!).zoom, 18, 'a restored view stays an area');
  assert.equal(serializeViewport({ latitude: Number.NaN, longitude: 7 }, 12), null);
  for (const bad of [null, '', '{', '[]', '{"version":2,"latitude":45,"longitude":7,"zoom":12}', '{"version":1,"latitude":"45","longitude":7,"zoom":12}',
    '{"version":1,"latitude":95,"longitude":7,"zoom":12}', '{"version":1,"latitude":45,"longitude":7,"zoom":1}']) {
    assert.equal(parseViewport(bad), null, String(bad));
  }
  assert.ok(TURIN_OVERVIEW.zoom < 13, 'the fallback is an overview, not a street-level claim');
});

test('the viewport store stays local and tolerates storage failures', async () => {
  const data = new Map<string, string>();
  const store = createViewportStore({
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async key => { data.delete(key); },
  });
  assert.equal(await store.load(), null);
  await store.save({ latitude: 45.06, longitude: 7.68 }, 14);
  assert.deepEqual(await store.load(), { center: { latitude: 45.06, longitude: 7.68 }, zoom: 14 });
  assert.equal(await store.clear(), true);
  assert.equal(data.has(VIEWPORT_KEY), false);
  const broken = createViewportStore({ getItem: async () => { throw new Error('io'); }, setItem: async () => { throw new Error('io'); }, removeItem: async () => { throw new Error('io'); } });
  assert.equal(await broken.load(), null);
  await broken.save({ latitude: 45, longitude: 7 }, 12);
  assert.equal(await broken.clear(), false);
});
