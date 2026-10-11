import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteLeg } from '../domain/types';
import { createTransitTimeDraft, draftTransitTime, journeyDuration, journeyTime, journeyTimingLabel, nextRomeDate, savedJourneyTimeLabel, transitTimeDraftReducer, waitBefore } from './journey-presentation';

const leg: RouteLeg = {
  id: 'test', mode: 'bus', from: 'A', to: 'B', durationSeconds: 600, distanceMeters: 1000,
  transitLeg: true, interlineWithPreviousLeg: false, timingStatus: 'prediction', realTime: true,
  departureAt: 1_000_000, arrivalAt: 1_600_000, geometry: [], steps: [],
};

test('journey durations round total minutes before splitting hours, including rollover boundaries', () => {
  for (const [seconds, expected] of [
    [0, '0 min'], [30, 'meno di 1 min'], [60, '1 min'],
    [3569, '59 min'], [3570, '1 h 0 min'], [3599, '1 h 0 min'], [3600, '1 h 0 min'],
    [7169, '1 h 59 min'], [7170, '2 h 0 min'], [7199, '2 h 0 min'], [7200, '2 h 0 min'],
  ] as const) assert.equal(journeyDuration(seconds), expected, `${seconds} seconds`);
});

test('opening explicit time from Adesso refreshes automatic defaults after minutes and Rome midnight', () => {
  const beforeMidnight = new Date('2026-10-11T21:58:00Z');
  const original = createTransitTimeDraft({ kind: 'now' }, beforeMidnight);
  assert.equal(original.date, '11/10/2026');
  assert.equal(original.time, '23:58');
  for (const kind of ['depart-at', 'arrive-by'] as const) {
    const opened = transitTimeDraftReducer(original, { type: 'kind', kind, now: new Date('2026-10-11T22:07:00Z') });
    assert.equal(opened.date, '12/10/2026');
    assert.equal(opened.time, '00:07');
    const nowAgain = transitTimeDraftReducer(opened, { type: 'kind', kind: 'now', now: beforeMidnight });
    const later = transitTimeDraftReducer(nowAgain, { type: 'kind', kind, now: new Date('2026-10-11T22:19:00Z') });
    assert.equal(later.time, '00:19');
  }
});

test('deliberate explicit edits survive mode toggles until submitting a new Adesso search', () => {
  const original = new Date('2026-10-11T21:58:00Z');
  const later = new Date('2026-10-12T07:05:00Z');
  let draft = createTransitTimeDraft({ kind: 'now' }, original);
  draft = transitTimeDraftReducer(draft, { type: 'kind', kind: 'depart-at', now: original });
  draft = transitTimeDraftReducer(draft, { type: 'date', value: '14/10/2026' });
  draft = transitTimeDraftReducer(draft, { type: 'time', value: '17:45' });
  for (const kind of ['arrive-by', 'now', 'depart-at'] as const) {
    draft = transitTimeDraftReducer(draft, { type: 'kind', kind, now: later });
    assert.equal(draft.date, '14/10/2026');
    assert.equal(draft.time, '17:45');
  }
  draft = transitTimeDraftReducer(draft, { type: 'submitted', value: { kind: 'now' }, now: later });
  draft = transitTimeDraftReducer(draft, { type: 'kind', kind: 'arrive-by', now: new Date('2026-10-12T07:11:00Z') });
  assert.equal(draft.date, '12/10/2026');
  assert.equal(draft.time, '09:11');
});

test('a submitted explicit query remains deliberate when the form reopens', () => {
  const now = new Date('2026-10-11T21:58:00Z');
  let draft = createTransitTimeDraft({ kind: 'arrive-by', date: '2026-10-14', time: '17:45' }, now);
  draft = transitTimeDraftReducer(draft, { type: 'kind', kind: 'now', now });
  draft = transitTimeDraftReducer(draft, { type: 'kind', kind: 'depart-at', now });
  assert.equal(draft.date, '14/10/2026');
  assert.equal(draft.time, '17:45');
});

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

test('even a just-saved prediction is stale while scheduled, cancelled and unknown remain distinct', () => {
  const fetchedAt = 1_000_000;
  assert.equal(journeyTimingLabel(leg, fetchedAt, fetchedAt, true), 'Previsione MATO da aggiornare');
  for (const [timingStatus, expected] of [
    ['scheduled', 'Orario programmato'], ['cancelled', 'Corsa cancellata'], ['unknown', 'Stato dell’orario non disponibile'],
  ] as const) assert.equal(journeyTimingLabel({ ...leg, timingStatus }, fetchedAt, fetchedAt, true), expected);
  assert.equal(leg.timingStatus, 'prediction');
});

test('saved now describes historical consultation while fixed departure and arrival retain exact civil times', () => {
  const fetchedAt = new Date('2026-10-11T21:15:00Z').getTime();
  assert.equal(savedJourneyTimeLabel({ kind: 'now' }, fetchedAt), 'Partenza richiesta il 11 ott 2026 alle 23:15 (ora della consultazione)');
  assert.equal(savedJourneyTimeLabel({ kind: 'depart-at', date: '2026-10-12', time: '08:30' }, fetchedAt), 'Partenza alle 08:30 del 12/10/2026');
  assert.equal(savedJourneyTimeLabel({ kind: 'arrive-by', date: '2026-10-12', time: '19:45' }, fetchedAt), 'Arrivo entro 19:45 del 12/10/2026');
});

test('saved road journeys never claim a retained transit departure or arrival constraint', () => {
  const fetchedAt = new Date('2026-10-11T21:15:00Z').getTime();
  for (const mode of ['walk', 'bicycle', 'car'] as const) {
    for (const transitTime of [
      { kind: 'now' }, { kind: 'depart-at', date: '2026-10-12', time: '08:30' },
      { kind: 'arrive-by', date: '2026-10-12', time: '19:45' },
    ] as const) assert.equal(savedJourneyTimeLabel(transitTime, fetchedAt, mode), null);
  }
  assert.equal(savedJourneyTimeLabel({ kind: 'arrive-by', date: '2026-10-12', time: '19:45' }, fetchedAt, 'transit'), 'Arrivo entro 19:45 del 12/10/2026');
});
