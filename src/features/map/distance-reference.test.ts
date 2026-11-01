import test from 'node:test';
import assert from 'node:assert/strict';
import { DISTANCE_FIX_MAX_AGE_MS, distanceFrom, distanceReference } from './distance-reference';

const mole = { latitude: 45.0690, longitude: 7.6933 };
const nearMole = { latitude: 45.0712, longitude: 7.6854 };
const centralItaly = { latitude: 42.5, longitude: 12.5 };
const now = 1_800_000_000_000;

test('a fresh device fix is the distance reference, not the map centre', () => {
  const reference = distanceReference({ device: nearMole, fixedAt: now - 30_000, now, mapCenter: centralItaly });
  assert.equal(reference.kind, 'device');
  const distance = distanceFrom(reference, mole);
  assert.ok(distance.meters < 1000, `${distance.meters} m: a Turin landmark seen from Turin is not hundreds of km away`);
  assert.doesNotMatch(distance.label, /centro/);
  assert.match(distance.spoken, /da te/);
});

test('without a fresh fix the distance is labelled as measured from the map centre', () => {
  for (const [device, fixedAt] of [[null, null], [nearMole, now - DISTANCE_FIX_MAX_AGE_MS - 1], [nearMole, null], [nearMole, now + 10 * 60_000]] as const) {
    const reference = distanceReference({ device, fixedAt, now, mapCenter: centralItaly });
    assert.equal(reference.kind, 'map');
    const distance = distanceFrom(reference, mole);
    assert.match(distance.label, /km dal centro mappa$/);
    assert.match(distance.spoken, /dal centro della mappa/);
  }
});

test('a selected stop or place shows a distance only from a fresh fix', async () => {
  const { detailDistance } = await import('./distance-reference');
  assert.equal(detailDistance(distanceReference({ device: null, fixedAt: null, now, mapCenter: mole }), mole), null, 'no "0 m dal centro mappa" for an item centred on the map');
  assert.match(detailDistance(distanceReference({ device: nearMole, fixedAt: now, now, mapCenter: centralItaly }), mole)!.label, /^\d+ m$/);
});
