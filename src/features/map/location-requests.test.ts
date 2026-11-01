import test from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinate } from '../../domain/types';
import { LocationError } from '../../platform/location-request';
import { createLocationRequests } from './location-requests';

const here: Coordinate = { longitude: 7.68, latitude: 45.07 };

function harness() {
  const log: string[] = [];
  const pending: { resolve(value: Coordinate): void; reject(error: unknown): void }[] = [];
  const requests = createLocationRequests({
    locate: () => new Promise<Coordinate>((resolve, reject) => { pending.push({ resolve, reject }); }),
    now: () => 1_000,
    record: () => log.push('record'),
    center: () => log.push('center'),
    adopt: () => log.push('adopt'),
    setLocating: () => {},
    cancelled: () => log.push('cancelled'),
  });
  // Settles every request still waiting for the platform, oldest first.
  const all = (settle: (entry: (typeof pending)[number]) => void) => { for (const entry of pending.splice(0)) settle(entry); };
  return { requests, log, fix: () => all(entry => entry.resolve(here)), fail: (error: unknown) => all(entry => entry.reject(error)) };
}

test('a Locate suspended by the permission dialog resolves with the fix it centres on', async () => {
  const { requests, log, fix } = harness();
  const outcome = requests.acquire({ recenter: true });
  requests.suspend();
  assert.deepEqual(log, [], 'the planner keeps locating while Locate waits for its fix');
  fix();
  assert.deepEqual(await outcome, { coordinate: here });
  assert.deepEqual(log, ['record', 'center']);
});

test('an interrupted Locate resolves with the fix the foreground acquisition brings on return', async () => {
  const { requests, log, fail } = harness();
  const outcome = requests.acquire({ recenter: true });
  requests.suspend();
  fail(new LocationError('unavailable', 'Richiesta posizione interrotta.'));
  await Promise.resolve();
  requests.foregroundFix(here, requests.current());
  assert.deepEqual(await outcome, { coordinate: here });
  assert.deepEqual(log, ['record', 'center']);
});

test('a denial in the dialog or a missing permission on return fails the suspended Locate', async () => {
  const denied = harness();
  const first = denied.requests.acquire({ recenter: true });
  denied.requests.suspend();
  denied.fail(new LocationError('denied', 'no'));
  const result = await first;
  assert.ok(result && 'error' in result);

  const missing = harness();
  const second = missing.requests.acquire({ recenter: true });
  missing.requests.suspend();
  missing.fail(new LocationError('unavailable', 'interrotta'));
  await Promise.resolve();
  missing.requests.foregroundFailed(missing.requests.current());
  const settled = await second;
  assert.ok(settled && 'error' in settled && settled.error instanceof LocationError && settled.error.code === 'denied');
});

test('only a user choice or a newer request resolves Locate with null', async () => {
  const cancelled = harness();
  const first = cancelled.requests.acquire({ recenter: true });
  cancelled.requests.cancel();
  cancelled.fix();
  assert.equal(await first, null);
  assert.deepEqual(cancelled.log, ['cancelled'], 'a late fix after a pan neither centres nor records');

  const superseded = harness();
  const older = superseded.requests.acquire({ recenter: true });
  void superseded.requests.acquire();
  assert.equal(await older, null);
  superseded.fix();
  await Promise.resolve();
  assert.deepEqual(superseded.log, ['record', 'center', 'record'], 'a newer request does not withdraw a live centre; each records its fix');

  const plain = harness();
  const route = plain.requests.acquire();
  plain.requests.suspend();
  plain.fix();
  assert.equal(await route, null, 'a suspended origin request without Locate stays superseded');
  assert.deepEqual(plain.log, ['cancelled']);
});
