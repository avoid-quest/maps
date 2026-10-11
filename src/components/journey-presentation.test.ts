import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteLeg } from '../domain/types';
import { draftTransitTime, journeyTime, journeyTimingLabel, nextRomeDate, waitBefore } from './journey-presentation';

const leg: RouteLeg = {
  id: 'test', mode: 'bus', from: 'A', to: 'B', durationSeconds: 600, distanceMeters: 1000,
  transitLeg: true, interlineWithPreviousLeg: false, timingStatus: 'prediction', realTime: true,
  departureAt: 1_000_000, arrivalAt: 1_600_000, geometry: [], steps: [],
};

test('Italian form dates are validated before submitting; stale or ambiguous text cannot become a request', () => {
  assert.deepEqual(draftTransitTime('arrive-by', '12/10/2026', '08:15'), { kind: 'arrive-by', date: '2026-10-12', time: '08:15' });
  assert.throws(() => draftTransitTime('depart-at', '31/02/2026', '08:15'), /data valida/);
  assert.throws(() => draftTransitTime('depart-at', '10/12/2026', '8:15'), /HH:mm/);
  assert.throws(() => draftTransitTime('depart-at', '25/10/2026', '02:30'), /ambiguo/);
  assert.throws(() => draftTransitTime('depart-at', '29/03/2026', '02:30'), /inesistente/);
  assert.deepEqual(draftTransitTime('now', 'unfinished', 'bad'), { kind: 'now' });
});

test('today/tomorrow and displayed leg time use Rome across midnight and daylight-saving boundaries', () => {
  const lateUtc = new Date('2026-10-11T23:30:00Z');
  assert.equal(nextRomeDate(0, lateUtc), '2026-10-12');
  assert.equal(nextRomeDate(1, lateUtc), '2026-10-13');
  assert.equal(nextRomeDate(1, new Date('2026-03-28T23:30:00Z')), '2026-03-30');
  assert.equal(journeyTime(lateUtc.getTime()), '01:30');
});

test('prediction age never upgrades scheduled, cancelled or unknown information to live', () => {
  assert.equal(journeyTimingLabel(leg, 1_000_000, 1_030_000), 'Previsione MATO');
  assert.equal(journeyTimingLabel(leg, 1_000_000, 1_121_000), 'Previsione MATO da aggiornare');
  assert.equal(journeyTimingLabel({ ...leg, timingStatus: 'cancelled' }, 1_000_000, 1_200_000), 'Corsa cancellata');
  assert.equal(journeyTimingLabel({ ...leg, timingStatus: 'scheduled' }, 1_000_000, 1_200_000), 'Orario programmato');
  assert.equal(journeyTimingLabel({ ...leg, timingStatus: 'unknown' }, 1_000_000, 1_200_000), 'Stato dell’orario non disponibile');
});

test('wait intervals include transfers after walking but never fabricate a wait with missing timestamps', () => {
  assert.equal(waitBefore({ ...leg, departureAt: 1_900_000 }, { ...leg, mode: 'walk' }), 300);
  assert.equal(waitBefore({ ...leg, departureAt: 1_900_000, interlineWithPreviousLeg: true }, leg), 300);
  assert.equal(waitBefore(leg), 0);
  assert.equal(waitBefore(leg, { ...leg, arrivalAt: undefined }), 0);
  assert.equal(waitBefore(leg, leg), 0);
});
