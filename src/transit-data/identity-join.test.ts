import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import { composeBoard } from './board';
import { joinFeed } from './identity-join';
import { createMemoryReader, datasetMeta } from './reader';
import { indexFeed, type RTFeed, type TripUpdate } from './realtime';
import { INITIAL_REFRESH_STATE } from './refresh-policy';
import { createMemoryRemapStore, type RemapData } from './remap';
import { timetableService } from './runtime';
import { encodePackage, fixtureManifest, fixturePackage, fixtureReader, rome } from './test-support/fixture';

const FIXTURES = path.join(__dirname, 'test-support/fixtures');
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

test('replay: the 20261011 package joins 156 of 157 live 20261101 trips by identity, none off by a minute', { timeout: 30_000 }, async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'gtt-identity-replay.json'), 'utf8'));
  const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
  const feed = Feed.toObject(Feed.decode(fs.readFileSync(path.join(FIXTURES, 'gtt-trip-updates-20261101.pb'))), { longs: Number, enums: String }) as RTFeed;
  const snapshot = indexFeed(feed, Number(feed.header!.timestamp) * 1000);
  const oldPackage = fixture.oldPackage;
  const old = createMemoryReader(oldPackage, datasetMeta(oldPackage, fixtureManifest(encodePackage(oldPackage), oldPackage), 'bundled'));
  const remap = createMemoryRemapStore();
  await remap.replace({
    meta: { fetchedAt: 1, crc32: {}, trips: fixture.remapTrips.length },
    trips: new Map(fixture.remapTrips.map((row: string[]) => [row[0], { routeId: row[1], direction: Number(row[2]), shapeId: row[3], serviceId: row[4] }])),
    calendar: fixture.remapCalendar.map((row: Record<string, string>) => ({ serviceId: row.service_id, mask: WEEKDAYS.reduce((mask, day, bit) => mask | (row[day] === '1' ? 1 << bit : 0), 0), start: row.start_date, end: row.end_date })),
    exceptions: fixture.remapExceptions.map((row: Record<string, string>) => ({ serviceId: row.service_id, date: row.date, added: row.exception_type === '1' })),
  } satisfies RemapData);

  assert.equal(snapshot.tripUpdates, 157);
  assert.equal((await joinFeed(snapshot, old)).matchedTrips, 0, 'GTT re-issued every trip ID');
  const joined = await joinFeed(snapshot, old, remap);
  assert.equal(joined.identityMatched, 156);
  assert.deepEqual(joined.rejected, { ambiguous: 0, mismatch: 0, noSchedule: 1 }, 'one genuinely changed schedule is not guessed');
  assert.equal(joined.unknownTrips, 0);

  // Ground truth: the 20261101 package (bundled) has the live trips under their current IDs.
  const { reader: today } = await timetableService.current();
  assert.equal((await joinFeed(snapshot, today)).matchedTrips, 157);
  const current = await today.trips([...snapshot.byTrip.keys()]);
  let exact = 0; let maxError = 0;
  for (const [localId, list] of joined.byLocalTrip) for (const { update } of list) {
    const before = (await old.trips([localId])).get(localId)!; const after = current.get(update.trip!.tripId!)!;
    const [beforePattern, afterPattern] = [(await old.patterns([before.patternId])).get(before.patternId)!, (await today.patterns([after.patternId])).get(after.patternId)!];
    const [beforeTimes, afterTimes] = [(await old.vectors([before.vectorId])).get(before.vectorId)!, (await today.vectors([after.vectorId])).get(after.vectorId)!];
    let same = true;
    for (const stopUpdate of update.stopTimeUpdate ?? []) {
      const [a, b] = [beforePattern.sequences.indexOf(stopUpdate.stopSequence!), afterPattern.sequences.indexOf(stopUpdate.stopSequence!)];
      assert.equal(beforePattern.stopIds[a], afterPattern.stopIds[b], 'every reported stop is the same stop');
      const error = Math.abs(before.start + beforeTimes.arrivals[a]! - after.start - afterTimes.arrivals[b]!);
      maxError = Math.max(maxError, error); if (error) same = false;
    }
    if (same) exact++;
  }
  assert.equal(exact, 150);
  assert.ok(maxError <= 3, `re-timed trips differ by ${maxError} s at reported stops`);
});

// --- Synthetic identity cases on the fixture package (T1: route 4U, direction 0, shape 4A, 08:00) ---
const NOW = rome('20261021', '07:58');
const sec = (ms: number) => ms / 1000;
const remapWith = async (trips: [string, string, number, string, string][], extra: Partial<RemapData> = {}) => {
  const store = createMemoryRemapStore();
  await store.replace({ meta: { fetchedAt: 1, crc32: {}, trips: trips.length }, trips: new Map(trips.map(([id, routeId, direction, shapeId, serviceId]) => [id, { routeId, direction, shapeId, serviceId }])),
    calendar: [{ serviceId: 'NEW', mask: 127, start: '20261001', end: '20261231' }], exceptions: [], ...extra });
  return store;
};
const update = (tripId: string, extra: Partial<TripUpdate> = {}): TripUpdate => ({
  timestamp: sec(NOW - 10_000), trip: { tripId, startDate: '20261021', startTime: '08:00:00' }, stopTimeUpdate: [{ stopSequence: 3, arrival: { delay: 120 } }], ...extra,
});
const snapshotOf = (...updates: TripUpdate[]) => indexFeed({ header: { gtfsRealtimeVersion: '2.0', timestamp: sec(NOW) }, entity: updates.map((tripUpdate, index) => ({ id: String(index), tripUpdate })) }, NOW);

test('identity joins are exact or absent: date, start time, calendar and stop_sequence are all checked', async () => {
  const reader = fixtureReader();
  const remap = await remapWith([['NEW-T1', '4U', 0, '4A', 'NEW'], ['NEW-OFF', '4U', 0, '4A', 'OFF'], ['NEW-SHAPE', '4U', 0, 'other', 'NEW']]);
  const ok = await joinFeed(snapshotOf(update('NEW-T1')), reader, remap);
  assert.equal(ok.identityMatched, 1); assert.equal(ok.byLocalTrip.get('T1')?.[0]?.via, 'identity');
  const cases: [TripUpdate, keyof typeof ok.rejected | 'unknown'][] = [
    [update('NEW-OFF'), 'mismatch'], // GTT's current calendar does not run it that day
    [update('NEW-T1', { stopTimeUpdate: [{ stopSequence: 42, arrival: { delay: 0 } }] }), 'mismatch'], // stop_sequence not in the local pattern
    [update('NEW-T1', { stopTimeUpdate: [{ stopSequence: 3, stopId: 'C', arrival: { delay: 0 } }] }), 'mismatch'], // seq 3 is stop B
    [update('NEW-T1', { trip: { tripId: 'NEW-T1', startTime: '08:00:00' } }), 'mismatch'], // no start_date: never guessed
    [update('NEW-T1', { trip: { tripId: 'NEW-T1', startDate: '20261021', startTime: '08:01:00' } }), 'noSchedule'],
    [update('NEW-SHAPE'), 'noSchedule'],
    [update('UNKNOWN'), 'unknown'],
  ];
  for (const [input, expected] of cases) {
    const result = await joinFeed(snapshotOf(input), reader, remap);
    assert.equal(result.matchedTrips, 0, JSON.stringify(input.trip));
    if (expected === 'unknown') assert.equal(result.unknownTrips, 1); else assert.equal(result.rejected[expected], 1, `${expected}: ${JSON.stringify(input)}`);
  }
});

test('two different local schedules with one identity are ambiguous; identical ones are not', async () => {
  const pkg = fixturePackage();
  const t = pkg.trips; const clone = (id: string, vector: number) => {
    const index = t.trip_id.indexOf('T1');
    for (const key of Object.keys(t) as (keyof typeof t)[]) (t[key] as (string | number)[]).push(key === 'trip_id' ? id : key === 'vector' ? vector : t[key][index]!);
  };
  clone('T1-COPY', t.vector[t.trip_id.indexOf('T1')]!);
  const reader = createMemoryReader(pkg, datasetMeta(pkg, fixtureManifest(encodePackage(pkg), pkg), 'bundled'));
  const remap = await remapWith([['NEW-T1', '4U', 0, '4A', 'NEW']]);
  assert.equal((await joinFeed(snapshotOf(update('NEW-T1')), reader, remap)).rejected.ambiguous, 1, 'both run locally: ambiguous');
  const other = fixturePackage(); other.vectors.push([[0, 60, 60, 60], null]);
  const index = other.trips.trip_id.indexOf('T1');
  for (const key of Object.keys(other.trips) as (keyof typeof other.trips)[]) (other.trips[key] as (string | number)[]).push(key === 'trip_id' ? 'T1-RETIMED' : key === 'vector' ? other.vectors.length - 1 : key === 'service' ? other.services.findIndex(entry => entry[0] === 'HOL') : other.trips[key][index]!);
  const retimed = createMemoryReader(other, datasetMeta(other, fixtureManifest(encodePackage(other), other), 'bundled'));
  const result = await joinFeed(snapshotOf(update('NEW-T1')), retimed, remap);
  assert.equal(result.identityMatched, 1, 'the locally running schedule wins over a non-running variant');
});

test('an identity match outside the installed calendar extends the board, labelled as such', async () => {
  // T1 runs on ALL; HOL1 (08:20) runs only on 20261102 locally. GTT now runs it on 20261021 under a new ID.
  const reader = fixtureReader();
  const remap = await remapWith([['NEW-HOL1', '4U', 0, '4A', 'NEW']]);
  const live = update('NEW-HOL1', { trip: { tripId: 'NEW-HOL1', startDate: '20261021', startTime: '08:20:00' }, stopTimeUpdate: [{ stopSequence: 1, arrival: { delay: 60 } }] });
  const snapshot = snapshotOf(live);
  const join = await joinFeed(snapshot, reader, remap);
  assert.deepEqual(join.extensions.map(entry => [entry.trip.tripId, entry.serviceDate]), [['HOL1', '20261021']]);
  const board = await composeBoard(reader, 'A', NOW, { refresh: INITIAL_REFRESH_STATE, realtime: { snapshot, join } });
  const row = board.rows.find(candidate => candidate.gtt.tripId === 'HOL1')!;
  assert.equal(row.predictedAt, rome('20261021', '08:21'));
  assert.equal(row.gtt.calendar, 'realtime-identity'); assert.equal(row.gtt.joinedBy, 'identity');
  assert.match(row.gtt.note!, /fuori dal calendario installato/);
  const scheduledOnly = await composeBoard(reader, 'A', NOW, { refresh: INITIAL_REFRESH_STATE });
  assert.ok(!scheduledOnly.rows.some(candidate => candidate.gtt.tripId === 'HOL1'), 'never shown without the live match');
});
