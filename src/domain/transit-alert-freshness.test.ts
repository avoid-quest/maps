import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransitAlertSnapshot } from './types';
import { transitAlertWarnings } from './transit-alert-freshness';
const displayedAlertWarnings = (value: TransitAlertSnapshot, now: number) => transitAlertWarnings(value.sourceUpdatedAt, now, value.warnings);

const staleSource = 'Il feed degli avvisi GTT non è aggiornato: la loro applicabilità attuale non è confermata.';
const uncertainSource = 'La data di aggiornamento degli avvisi GTT non è verificabile.';
const fetchedAt = 1_000_000;
function snapshot(sourceUpdatedAt?: number, warnings: string[] = []): TransitAlertSnapshot {
  return { alerts: [], fetchedAt, sourceUpdatedAt, source: 'GTT', warnings };
}

test('a recently retrieved alert snapshot ages against its original source timestamp without another fetch', () => {
  const value = snapshot(fetchedAt - 290_000);
  assert.deepEqual(displayedAlertWarnings(value, fetchedAt), []);
  assert.deepEqual(displayedAlertWarnings(value, fetchedAt + 20_000), [staleSource]);
  assert.equal(value.fetchedAt, fetchedAt);
  assert.equal(value.sourceUpdatedAt, fetchedAt - 290_000);
  assert.deepEqual(value.warnings, []);
});

test('source uncertainty is evaluated at display time for missing, invalid and implausibly future timestamps', () => {
  for (const sourceUpdatedAt of [undefined, NaN, Infinity, 0, -1, fetchedAt + 60_001]) {
    assert.deepEqual(displayedAlertWarnings(snapshot(sourceUpdatedAt), fetchedAt), [uncertainSource]);
  }
  assert.deepEqual(displayedAlertWarnings(snapshot(fetchedAt + 60_000), fetchedAt), []);
});

test('current source assessment replaces frozen source warnings without duplicating them or removing other warnings', () => {
  const other = 'Un avviso indipendente dalla freschezza.';
  const displayed = displayedAlertWarnings(snapshot(fetchedAt - 310_000, [staleSource, other]), fetchedAt);
  assert.equal(displayed.filter(warning => warning === staleSource).length, 1);
  assert.ok(displayed.includes(other));
  const formerlyFuture = snapshot(fetchedAt + 70_000, [uncertainSource, other]);
  assert.deepEqual(displayedAlertWarnings(formerlyFuture, fetchedAt + 20_000), [other]);
  assert.deepEqual(formerlyFuture.warnings, [uncertainSource, other]);
});

test('source age and retrieval age remain separate at the five-minute boundary', () => {
  const value = snapshot(fetchedAt - 300_000);
  assert.deepEqual(displayedAlertWarnings(value, fetchedAt), []);
  assert.deepEqual(displayedAlertWarnings(value, fetchedAt + 1), [staleSource]);
  // Source time can be newer than retrieval after a small accepted clock skew.
  assert.deepEqual(displayedAlertWarnings(snapshot(fetchedAt + 30_000), fetchedAt + 300_001), []);
});
