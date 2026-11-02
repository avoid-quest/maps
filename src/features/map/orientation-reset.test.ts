import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrientationReset } from './orientation-reset';

test('the reset survives a superseded command and is carried by the next issued one, once', () => {
  const reset = createOrientationReset();
  assert.deepEqual(reset.apply({ duration: 250 }), { duration: 250 }, 'nothing armed: unchanged');
  reset.arm();
  // The padding re-centre was superseded before its async centre resolved: it never called apply.
  // The browsing follow ease issued in the same flush carries the pose instead.
  assert.deepEqual(reset.apply({ duration: 450 }), { duration: 450, bearing: 0, pitch: 0 });
  assert.equal(reset.armed, false);
  assert.deepEqual(reset.apply({ duration: 250 }), { duration: 250 }, 'applied once only');
});

test('a user gesture after guidance keeps the chosen view', () => {
  const reset = createOrientationReset();
  reset.arm();
  reset.userMoved();
  assert.deepEqual(reset.apply({ duration: 250 }), { duration: 250 });
});
