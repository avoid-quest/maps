import test from 'node:test';
import assert from 'node:assert/strict';
import { idleNavigation, navigationLocationForReplan, type NavigationSnapshot } from './navigation';

const now = Date.UTC(2026, 9, 12, 12);
const usable: NavigationSnapshot = { ...idleNavigation, status: 'error', mode: 'transit', problem: 'transit-replan-needed',
  location: { latitude: 45, longitude: 7, accuracyMeters: 8, timestamp: now } };

test('transit replanning uses only a fresh precise fix and never a stale retained map dot', () => {
  assert.deepEqual(navigationLocationForReplan(usable, now), { latitude: 45, longitude: 7 });
  assert.deepEqual(navigationLocationForReplan({ ...usable, location: { ...usable.location!, timestamp: now - 10_000, accuracyMeters: 35 } }, now), { latitude: 45, longitude: 7 });
  for (const patch of [
    { timestamp: now - 10_001 }, { timestamp: now + 1 }, { timestamp: NaN },
    { accuracyMeters: 36 }, { accuracyMeters: 0 }, { accuracyMeters: Infinity }, { latitude: 91 }, { longitude: -181 },
  ]) assert.equal(navigationLocationForReplan({ ...usable, location: { ...usable.location!, ...patch } }, now), null);
  assert.equal(navigationLocationForReplan({ ...usable, status: 'location-degraded' }, now), null);
  for (const problem of ['location-permission', 'location-disabled', 'location-stale', 'location-inaccurate'] as const) {
    assert.equal(navigationLocationForReplan({ ...usable, problem }, now), null);
  }
  assert.equal(navigationLocationForReplan({ ...usable, location: undefined }, now), null);
});
