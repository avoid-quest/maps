import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTransitTime, romeDateTime } from './transit-time';
import { ServiceError } from './network';

test('explicit civil times use Rome and preserve arrive-by independently of device timezone', () => {
  assert.deepEqual(resolveTransitTime({ kind: 'depart-at', date: '2026-10-12', time: '09:30' }), { date: '2026-10-12', time: '09:30:00', arriveBy: false });
  assert.deepEqual(resolveTransitTime({ kind: 'arrive-by', date: '2026-01-12', time: '09:30' }), { date: '2026-01-12', time: '09:30:00', arriveBy: true });
  assert.deepEqual(resolveTransitTime({ kind: 'now' }, new Date('2026-10-11T22:30:00Z')), { date: '2026-10-12', time: '00:30:00', arriveBy: false });
  assert.deepEqual(romeDateTime(new Date('2026-01-11T23:30:00Z')), { date: '2026-01-12', time: '00:30:00' });
});

test('Rome spring gap and autumn repeated hour are rejected; adjacent times remain valid', () => {
  assert.throws(() => resolveTransitTime({ kind: 'depart-at', date: '2026-03-29', time: '02:30' }), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid' && error.message.includes('inesistente'));
  assert.throws(() => resolveTransitTime({ kind: 'arrive-by', date: '2026-10-25', time: '02:30' }), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid' && error.message.includes('ambiguo'));
  for (const date of ['2026-03-29', '2026-10-25']) for (const time of ['01:59', '03:00']) {
    assert.equal(resolveTransitTime({ kind: 'depart-at', date, time }).time, `${time}:00`);
  }
});

test('invalid dates and times cannot overflow silently or inject a provider query', () => {
  for (const [date, time] of [
    ['2026-02-30', '09:00'], ['2026-13-01', '09:00'], ['2026-10-12', '24:00'],
    ['2026-10-12', '09:60'], ['2026-10-12', '9:00'], ['2026-10-12', '09:00:61'],
    ['2026-10-12"', '09:00'], ['12/10/2026', '09:00'], ['2026-02-29', '09:00'],
  ]) assert.throws(() => resolveTransitTime({ kind: 'depart-at', date: date!, time: time! }), ServiceError);
  assert.equal(resolveTransitTime({ kind: 'depart-at', date: '2028-02-29', time: '09:00' }).date, '2028-02-29');
});
