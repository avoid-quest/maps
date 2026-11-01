import test from 'node:test';
import assert from 'node:assert/strict';
import { TURIN_OVERVIEW } from './coordinates';
import { createRecenterIntent } from './recenter-intent';
import { createViewportStore, mayPersistSettledView, parseViewport, serializeViewport, VIEWPORT_KEY } from './viewport-store';

test('Locate centres on the first fix even when the permission dialog suspended the request', () => {
  const intent = createRecenterIntent();
  intent.request(1, 0);
  // The dialog backgrounds the app: request 1 is superseded by the lifecycle, the intent is not.
  assert.equal(intent.pending(5_000), true);
  assert.equal(intent.take(8_000), 'center', 'the foreground fix after granting permission centres the camera');
  assert.equal(intent.take(9_000), 'adopt', 'only the first fix is consumed');
});

test('a user choice, a failed or denied request, or a missing permission withdraws the pending centre', () => {
  const intent = createRecenterIntent();
  intent.request(1, 0); intent.withdraw();
  assert.equal(intent.take(1), 'adopt', 'a pan after Locate wins over a late fix');
  intent.request(2, 0); intent.failed(2);
  assert.equal(intent.take(1), 'adopt', 'denied in the dialog: the suspended request still ends the intent');
  intent.request(3, 0); intent.notAuthorized();
  assert.equal(intent.take(1), 'adopt', 'the resumed permission check found no permission');
  intent.request(5, 0); intent.failed(4);
  assert.equal(intent.pending(1), true, 'an older request failing does not cancel a newer Locate');
  assert.equal(createRecenterIntent().take(0), 'adopt', 'a launch fix without Locate only adopts an untouched camera');
});

test('the permission handoff is bounded in time', () => {
  const intent = createRecenterIntent(90_000);
  intent.request(1, 1_000);
  assert.equal(intent.pending(91_000), true);
  assert.equal(intent.take(91_001), 'adopt', 'a fix long after Locate does not move the camera');
  intent.request(2, 10_000);
  assert.equal(intent.take(5_000), 'adopt', 'a clock that went backwards does not keep the intent alive');
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

test('a fit away from the launch overview stops being labelled as the overview', async () => {
  const { movedFromOverview } = await import('./useMapCamera');
  assert.equal(movedFromOverview(TURIN_OVERVIEW.center, TURIN_OVERVIEW.zoom), false, 'the launch view itself');
  assert.equal(movedFromOverview({ latitude: TURIN_OVERVIEW.center.latitude + 0.0002, longitude: TURIN_OVERVIEW.center.longitude }, TURIN_OVERVIEW.zoom + 0.1), false, 'settling jitter');
  assert.equal(movedFromOverview({ latitude: 45.062, longitude: 7.678 }, 15), true, 'framed results');
  assert.equal(movedFromOverview(TURIN_OVERVIEW.center, 14), true, 'zoomed in on the same centre');
});

test('a forgotten view is not recreated by passive camera settles', () => {
  assert.equal(mayPersistSettledView({ engaged: true, forgotten: false }), true, 'programmatic fits persist once the user engaged');
  assert.equal(mayPersistSettledView({ engaged: false, forgotten: false }), false, 'nothing persists before engagement');
  assert.equal(mayPersistSettledView({ engaged: true, forgotten: true }), false, 'closing a sheet after "Dimentica l\'ultima vista" must not save again');
});
