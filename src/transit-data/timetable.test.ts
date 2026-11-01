import test from 'node:test';
import assert from 'node:assert/strict';
import { activeServiceIds, addDays, romeDate, serviceDayOrigin, serviceTime, weekday } from './calendar';
import { composeBoard } from './board';
import { agedRow } from './board-model';
import { indexFeed, predictEvent, updateForEvent, type RTFeed, type TripUpdate } from './realtime';
import { INITIAL_REFRESH_STATE } from './refresh-policy';
import { scheduledEvents, type ScheduledEvent } from './scheduled-board';
import { fixturePackage, fixtureReader, rome } from './test-support/fixture';

const reader = fixtureReader();
const iso = (ms: number) => new Date(ms).toISOString();

test('service days use noon minus 12h in Europe/Rome across both DST changes', () => {
  assert.equal(iso(serviceTime('20261021', 8 * 3600)), '2026-10-21T06:00:00.000Z', 'CEST');
  assert.equal(iso(serviceTime('20261026', 8 * 3600)), '2026-10-26T07:00:00.000Z', 'CET');
  // On the 25-hour autumn day GTFS time 0 is local 01:00 CEST; 08:00 stays 08:00 CET.
  assert.equal(iso(serviceDayOrigin('20261025')), '2026-10-24T23:00:00.000Z');
  assert.equal(iso(serviceTime('20261025', 8 * 3600)), '2026-10-25T07:00:00.000Z');
  assert.equal(iso(serviceTime('20260329', 8 * 3600)), '2026-03-29T06:00:00.000Z', 'spring 23-hour day');
  assert.equal(romeDate(Date.parse('2026-10-20T22:30:00Z')), '20261021', 'after Rome midnight');
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(weekday('20261102'), 0, 'Monday');
});

test('calendar exceptions override weekly patterns', () => {
  const pkg = fixturePackage();
  const rows = pkg.services.map(([serviceId, mask, start, end]) => ({ serviceId, mask, start, end }));
  const exceptions = pkg.services.flatMap(([serviceId, , , , added, removed]) => [
    ...added.map(date => ({ serviceId, date, added: true })), ...removed.map(date => ({ serviceId, date, added: false }))]);
  assert.deepEqual([...activeServiceIds(rows, exceptions, '20261021')].sort(), ['ALL', 'WK']);
  assert.deepEqual([...activeServiceIds(rows, exceptions, '20261102')].sort(), ['ALL', 'HOL'], 'holiday Monday');
  assert.deepEqual([...activeServiceIds(rows, exceptions, '20261025')].sort(), ['ALL'], 'Sunday');
  assert.deepEqual([...activeServiceIds(rows, exceptions, '20261201')], [], 'after the calendar');
});

const ids = (events: ScheduledEvent[]) => events.map(event => `${event.trip.tripId}@${event.serviceDate}#${event.position}`).sort();

test('scheduled events keep real stop_sequence, repeated visits and service exceptions', async () => {
  const at = rome('20261021', '07:55');
  const { events, coverage } = await scheduledEvents(reader, 'A', at, { lookbackMs: 0, horizonMs: 90 * 60_000 });
  assert.equal(coverage, 'covered');
  assert.deepEqual(ids(events), ['L1@20261021#0', 'L1@20261021#2', 'T1@20261021#0', 'T2@20261021#0']);
  const loop = events.filter(event => event.trip.tripId === 'L1').map(event => event.scheduledAt! - rome('20261021', '09:00'));
  assert.deepEqual(loop.sort((a, b) => a - b), [0, 120_000], 'the second visit to A has its own offset');
  const atB = await scheduledEvents(reader, 'C', at, { lookbackMs: 0, horizonMs: 90 * 60_000 });
  assert.equal(atB.events.find(event => event.trip.tripId === 'T1')?.pattern.sequences[atB.events.find(event => event.trip.tripId === 'T1')!.position], 7, 'real stop_sequence 7');
  const holiday = await scheduledEvents(reader, 'A', rome('20261102', '07:55'), { lookbackMs: 0, horizonMs: 40 * 60_000 });
  assert.deepEqual(ids(holiday.events), ['HOL1@20261102#0', 'T1@20261102#0'], 'WK removed, HOL added');
});

test('terminating and no-pickup visits are not departures', async () => {
  const atD = await scheduledEvents(reader, 'D', rome('20261021', '07:55'), { lookbackMs: 0, horizonMs: 60 * 60_000 });
  assert.deepEqual(atD.events, [], 'D is the terminus');
  const atB = await scheduledEvents(reader, 'B', rome('20261021', '09:55'), { lookbackMs: 0, horizonMs: 30 * 60_000 });
  assert.ok(!atB.events.some(event => event.trip.tripId === 'DROP1'), 'drop-off only');
});

test('times after 24:00 belong to the previous service day', async () => {
  // TLATE starts 25:30 on 20261021 = 01:30 on 22 October.
  const { events } = await scheduledEvents(reader, 'A', rome('20261022', '01:00'), { lookbackMs: 0, horizonMs: 60 * 60_000 });
  const late = events.find(event => event.trip.tripId === 'TLATE');
  assert.equal(late?.serviceDate, '20261021');
  assert.equal(late?.scheduledAt, rome('20261022', '01:30'));
  // Before midnight the same trip appears from today's service day, not tomorrow's.
  const evening = await scheduledEvents(reader, 'A', rome('20261021', '23:50'), { lookbackMs: 0, horizonMs: 2 * 3_600_000 });
  assert.deepEqual(evening.events.filter(event => event.trip.tripId === 'TLATE').map(event => event.serviceDate), ['20261021']);
});

test('DST fall-back day keeps scheduled civil times', async () => {
  const { events } = await scheduledEvents(reader, 'A', rome('20261025', '07:55'), { lookbackMs: 0, horizonMs: 10 * 60_000 });
  assert.equal(events.find(event => event.trip.tripId === 'T1')?.scheduledAt, rome('20261025', '08:00'));
});

test('frequencies: exact times expand, inexact headways never fabricate times', async () => {
  const exact = await scheduledEvents(reader, 'A', rome('20261021', '13:59'), { lookbackMs: 0, horizonMs: 40 * 60_000 });
  assert.deepEqual(exact.events.filter(event => event.trip.tripId === 'FQX').map(event => event.scheduledAt), [rome('20261021', '14:00'), rome('20261021', '14:10'), rome('20261021', '14:20')]);
  const inexact = await scheduledEvents(reader, 'B', rome('20261021', '12:20'), { lookbackMs: 0, horizonMs: 30 * 60_000 });
  const level = inexact.events.find(event => event.trip.tripId === 'FQ');
  assert.equal(level?.scheduledAt, undefined);
  assert.deepEqual(level?.frequency, { headwaySeconds: 600, from: rome('20261021', '12:02'), until: rome('20261021', '13:02') });
});

test('outside calendar coverage nothing is extrapolated', async () => {
  const result = await scheduledEvents(reader, 'A', rome('20261201', '08:00'));
  assert.deepEqual(result, { events: [], coverage: 'outside', serviceDates: [] });
  const board = await composeBoard(reader, 'A', rome('20261201', '08:00'), { refresh: INITIAL_REFRESH_STATE });
  assert.equal(board.rows.length, 0);
  assert.ok(board.notices.some(notice => notice.code === 'schedule-outside-coverage' && notice.action === 'update-schedules'));
});

// --- GTFS-RT join -------------------------------------------------------------------------
const NOW = rome('20261021', '08:02');
const sec = (ms: number) => ms / 1000;
async function eventAt(stopId: string, tripId: string, now = NOW): Promise<ScheduledEvent> {
  const { events } = await scheduledEvents(reader, stopId, now, { lookbackMs: 30 * 60_000, horizonMs: 3 * 3_600_000 });
  return events.find(event => event.trip.tripId === tripId)!;
}
const update = (stopTimeUpdate: TripUpdate['stopTimeUpdate'], extra: Partial<TripUpdate> = {}): TripUpdate => ({
  timestamp: sec(NOW - 30_000), trip: { tripId: 'T1', startDate: '20261021', startTime: '08:00:00', scheduleRelationship: 'SCHEDULED' }, stopTimeUpdate, ...extra,
});

test('delay-only, absolute, zero and negative predictions', async () => {
  const atC = await eventAt('C', 'T1'); // scheduled 08:05:00 (offset 300 s), sequence 7
  const feedAt = NOW - 10_000;
  const delayOnly = predictEvent(atC, update([{ stopSequence: 7, arrival: { delay: 95 } }]), feedAt, NOW);
  assert.deepEqual(delayOnly, { state: 'fresh', predictedAt: rome('20261021', '08:05') + 95_000, predictedEvent: 'arrival', delaySeconds: 95, updatedAt: NOW - 30_000 });
  const absolute = predictEvent(atC, update([{ stopSequence: 7, departure: { time: sec(rome('20261021', '08:07')) }, arrival: { delay: 1 } }]), feedAt, NOW);
  assert.equal(absolute.predictedEvent, 'departure', 'departure wins, explicit time wins');
  assert.equal(absolute.predictedAt, rome('20261021', '08:07')); assert.equal(absolute.delaySeconds, 120);
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, arrival: { delay: 0 } }]), feedAt, NOW).delaySeconds, 0);
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, arrival: { delay: -45 } }]), feedAt, NOW).predictedAt, rome('20261021', '08:05') - 45_000);
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, arrival: {} }]), feedAt, NOW).state, 'unverifiable', 'missing delay is not zero');
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, arrival: { time: 0, delay: 30 } }]), feedAt, NOW).delaySeconds, 30, 'invalid time falls back to delay');
});

test('delay propagates downstream across SKIPPED, never across NO_DATA or upstream', async () => {
  const atC = await eventAt('C', 'T1'); const feedAt = NOW;
  const propagated = predictEvent(atC, update([{ stopSequence: 3, arrival: { time: sec(rome('20261021', '08:02') + 60_000) } }]), feedAt, NOW);
  assert.equal(propagated.propagated, true); assert.equal(propagated.delaySeconds, 60, 'time-only delay computed against schedule');
  assert.equal(propagated.predictedAt, rome('20261021', '08:06'));
  const overSkip = predictEvent(atC, update([{ stopSequence: 1, arrival: { delay: 30 } }, { stopSequence: 3, scheduleRelationship: 'SKIPPED' }]), feedAt, NOW);
  assert.equal(overSkip.delaySeconds, 30);
  assert.equal(predictEvent(atC, update([{ stopSequence: 1, arrival: { delay: 30 } }, { stopSequence: 3, scheduleRelationship: 'NO_DATA' }]), feedAt, NOW).state, 'no-data');
  assert.equal(predictEvent(atC, update([{ stopSequence: 9, arrival: { delay: 30 } }]), feedAt, NOW).state, 'before-first-update', 'no upstream propagation');
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, scheduleRelationship: 'NO_DATA' }]), feedAt, NOW).state, 'no-data');
});

test('cancelled trips and skipped stops are separate states', async () => {
  const atC = await eventAt('C', 'T1');
  assert.equal(predictEvent(atC, update([], { trip: { tripId: 'T1', startDate: '20261021', scheduleRelationship: 'CANCELED' } }), NOW, NOW).state, 'cancelled');
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, scheduleRelationship: 'SKIPPED' }]), NOW, NOW).state, 'skipped');
});

test('freshness needs plausible feed and entity timestamps; stale keeps its age', async () => {
  const atC = await eventAt('C', 'T1'); const stu = [{ stopSequence: 7, arrival: { delay: 60 } }];
  assert.equal(predictEvent(atC, update(stu, { timestamp: undefined }), NOW, NOW).state, 'unverifiable');
  assert.equal(predictEvent(atC, update(stu), undefined, NOW).state, 'unverifiable');
  assert.equal(predictEvent(atC, update(stu, { timestamp: sec(NOW + 5 * 60_000) }), NOW, NOW).state, 'unverifiable', 'future entity');
  const stale = predictEvent(atC, update(stu, { timestamp: sec(NOW - 5 * 60_000) }), NOW, NOW);
  assert.equal(stale.state, 'stale'); assert.equal(stale.updatedAt, NOW - 5 * 60_000);
  assert.equal(predictEvent(atC, update(stu), NOW - 3 * 60_000, NOW).state, 'stale', 'old feed header');
  assert.equal(predictEvent(atC, update(stu, { timestamp: sec(NOW - 31 * 60_000) }), NOW, NOW).state, 'expired');
});

test('explicit stop_id is validated and repeated visits need stop_sequence', async () => {
  const atC = await eventAt('C', 'T1');
  assert.equal(predictEvent(atC, update([{ stopSequence: 7, stopId: 'B', arrival: { delay: 60 } }]), NOW, NOW).state, 'unverifiable', 'mismatched stop_id ignored');
  assert.equal(predictEvent(atC, update([{ stopId: 'C', arrival: { delay: 60 } }]), NOW, NOW).delaySeconds, 60, 'unique stop_id resolves');
  const loop = await eventAt('A', 'L1', rome('20261021', '08:59'));
  const loopUpdate = { ...update([{ stopId: 'A', arrival: { delay: 60 } }]), trip: { tripId: 'L1', startDate: '20261021' } };
  assert.equal(predictEvent(loop, loopUpdate, NOW, NOW).state, 'unverifiable', 'stop A is visited twice');
});

test('joins require exact trip_id, service date and start time', async () => {
  const atC = await eventAt('C', 'T1');
  const feed = (trip: TripUpdate['trip']): RTFeed => ({ header: { gtfsRealtimeVersion: '2.0', timestamp: sec(NOW) }, entity: [{ id: '1', tripUpdate: { ...update([]), trip } }] });
  assert.ok(updateForEvent(indexFeed(feed({ tripId: 'T1', startDate: '20261021', startTime: '08:00:00' }), NOW), atC));
  assert.equal(updateForEvent(indexFeed(feed({ tripId: 'T1', startDate: '20261020' }), NOW), atC), undefined, 'other service day');
  assert.equal(updateForEvent(indexFeed(feed({ tripId: 'T1', startTime: '09:00:00' }), NOW), atC), undefined, 'other start time');
  assert.equal(updateForEvent(indexFeed(feed({ tripId: 'T2' }), NOW), atC), undefined);
  assert.ok(updateForEvent(indexFeed(feed({ tripId: 'T1' }), NOW), atC), 'no start date: single candidate accepted');
});

// --- Composed board -----------------------------------------------------------------------
const feed = (entities: TripUpdate[], timestamp = sec(NOW)): RTFeed => ({ header: { gtfsRealtimeVersion: '2.0', timestamp }, entity: entities.map((tripUpdate, index) => ({ id: String(index), tripUpdate })) });

test('board rows use the provider-neutral model with GTT provenance', async () => {
  const snapshot = indexFeed(feed([update([{ stopSequence: 1, arrival: { delay: 120 } }])]), NOW + 1_000);
  const board = await composeBoard(reader, 'A', NOW, { refresh: INITIAL_REFRESH_STATE, realtime: { snapshot, matchedTrips: 1 }, window: { lookbackMs: 30 * 60_000, horizonMs: 60 * 60_000 } });
  const t1 = board.rows.find(row => row.gtt.tripId === 'T1')!;
  assert.equal(t1.provider, 'gtt'); assert.equal(t1.realtimeState, 'realtime-with-source-time');
  assert.equal(t1.event, 'arrival', 'arrival-only prediction presented as an arrival');
  assert.equal(t1.predictedAt, rome('20261021', '08:02')); assert.equal(t1.scheduledAt, rome('20261021', '08:00'));
  assert.equal(t1.sourceUpdatedAt, NOW - 30_000); assert.equal(t1.retrievedAt, NOW + 1_000);
  assert.equal(t1.upstream.attribution, 'Data source: GTT S.p.A. – Gruppo Torinese Trasporti');
  assert.equal(t1.tripRef, 'gtt:T1:20261021');
  const t2 = board.rows.find(row => row.gtt.tripId === 'T2')!;
  assert.equal(t2.realtimeState, 'scheduled'); assert.equal(t2.timeBasis, 'scheduled'); assert.equal(t2.sourceUpdatedAt, undefined);
  assert.equal(board.realtime.state, 'ok');
  assert.ok(board.rows.indexOf(t1) < board.rows.indexOf(t2), 'sorted by effective time');
  // Two minutes later the same row is no longer live; after 30 minutes the prediction disappears.
  assert.equal(agedRow(t1, NOW + 2 * 60_000).realtimeState, 'unknown');
  assert.equal(agedRow(t1, NOW + 2 * 60_000).providerTimeAt, t1.predictedAt);
  assert.equal(agedRow(t1, NOW + 31 * 60_000).providerTimeAt, undefined);
});

test('metro is scheduled-only; a delayed vehicle stays until its predicted time', async () => {
  const metro = await composeBoard(reader, 'M1', NOW, { refresh: INITIAL_REFRESH_STATE, realtime: { snapshot: indexFeed(feed([]), NOW), matchedTrips: 0 } });
  const row = metro.rows.find(row => row.gtt.tripId === 'MET1')!;
  assert.equal(row.mode, 'metro'); assert.equal(row.realtimeState, 'scheduled'); assert.equal(row.gtt.note, 'Solo orari programmati — tempo reale non disponibile');
  const later = rome('20261021', '08:10');
  const late = indexFeed(feed([{ ...update([{ stopSequence: 1, arrival: { delay: 900 } }]), timestamp: sec(later - 20_000) }], sec(later)), later);
  const board = await composeBoard(reader, 'A', later, { refresh: INITIAL_REFRESH_STATE, realtime: { snapshot: late, matchedTrips: 1 } });
  assert.equal(board.rows.find(row => row.gtt.tripId === 'T1')?.predictedAt, rome('20261021', '08:15'), 'scheduled 08:00, predicted 08:15');
});

test('zero joins on a nonempty feed keep scheduled rows and ask for a schedule update', async () => {
  const snapshot = indexFeed(feed([{ ...update([]), trip: { tripId: 'OTHER-PACKAGE-TRIP' } }]), NOW);
  const board = await composeBoard(reader, 'A', NOW, { refresh: INITIAL_REFRESH_STATE, realtime: { snapshot, matchedTrips: 0 } });
  assert.equal(board.realtime.state, 'unmatched'); assert.equal(board.realtime.unmatchedTrips, 1);
  assert.ok(board.rows.length > 0 && board.rows.every(row => row.realtimeState === 'unknown' || row.mode === 'metro'));
  assert.deepEqual(board.notices.filter(notice => notice.code === 'realtime-unmatched'), [{ code: 'realtime-unmatched', text: 'Tempo reale non associabile agli orari disponibili', action: 'update-schedules' }]);
  assert.ok(!board.notices.some(notice => /\d+ corse/.test(notice.text)), 'counts stay in diagnostics');
  const offline = await composeBoard(reader, 'A', NOW, { refresh: INITIAL_REFRESH_STATE, realtime: { error: 'Rete assente.' } });
  assert.equal(offline.realtime.state, 'unavailable'); assert.ok(offline.rows.length > 0);
});
