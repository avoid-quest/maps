import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import { getScheduledBoard, getStopBoard, getTransitAlerts, RealtimeUnavailableError } from './transit';
import { ServiceError } from './network';
import { timetableService } from '../transit-data/runtime';
import { scheduledEvents } from '../transit-data/scheduled-board';
import { serviceTime } from '../transit-data/calendar';
import { bundledManifest } from '../transit-data/bundled';

const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
const response = (feed: unknown) => new Response(Feed.encode(Feed.fromObject(feed as object)).finish() as unknown as BodyInit);
/** Castello (public code 472) in the bundled package. */
const CASTELLO = '3019';
const day = bundledManifest.valid_from < '20261102' && bundledManifest.valid_to >= '20261102' ? '20261102' : bundledManifest.valid_from;

test('bundled package: Castello shows scheduled rows offline and joins delay-only GTT updates', { timeout: 30_000 }, async () => {
  const originalFetch = global.fetch; const originalNow = Date.now;
  let now = serviceTime(day, 8 * 3600); const requested: string[] = [];
  Date.now = () => now;
  try {
    global.fetch = async () => { throw new Error('scheduled rows must not need the network'); };
    const offline = await getScheduledBoard(CASTELLO);
    assert.ok(offline.rows.length >= 10, 'scheduled departures render without any request');
    assert.ok(offline.rows.every(row => row.provider === 'gtt' && row.realtimeState === 'scheduled' || row.mode === 'metro'));
    assert.equal(offline.stop.name, 'Fermata 472 - CASTELLO');

    const { reader } = await timetableService.current();
    const { events } = await scheduledEvents(reader, CASTELLO, now, { lookbackMs: 0, horizonMs: 30 * 60_000 });
    const target = events.find(event => event.position > 0)!;
    const sequence = target.pattern.sequences[target.position]!;
    const start = target.trip.start;
    const clock = [Math.floor(start / 3600), Math.floor(start / 60) % 60, start % 60].map(part => String(part).padStart(2, '0')).join(':');
    // Delay-only arrival at an earlier stop: GTT's prevalent shape (no time, no stop_id).
    const upstream = target.pattern.sequences[target.position - 1]!;
    const feed = { header: { gtfsRealtimeVersion: '2.0', timestamp: now / 1000 }, entity: [
      { id: 'match', tripUpdate: { timestamp: (now - 20_000) / 1000, trip: { tripId: target.trip.tripId, startDate: day, startTime: clock }, stopTimeUpdate: [{ stopSequence: upstream, arrival: { delay: 150 } }] } },
      { id: 'foreign', tripUpdate: { timestamp: (now - 20_000) / 1000, trip: { tripId: 'not-in-package' }, stopTimeUpdate: [{ stopSequence: 1, arrival: { delay: 0 } }] } },
    ] };
    global.fetch = async input => { requested.push(String(input)); return response(feed); };
    const board = await getStopBoard(CASTELLO);
    const row = board.rows.find(candidate => candidate.gtt.tripId === target.trip.tripId && candidate.scheduledAt === target.scheduledAt)!;
    assert.equal(row.realtimeState, 'realtime-with-source-time');
    assert.equal(row.timeBasis, 'propagated'); assert.equal(row.event, 'arrival');
    assert.equal(row.predictedAt, target.origin + (target.start + target.vector.arrivals[target.position]! + 150) * 1000);
    assert.equal(board.realtime.state, 'ok'); assert.equal(board.realtime.unmatchedTrips, 1);
    assert.ok(!board.notices.some(notice => notice.code === 'realtime-unmatched'), 'partial mismatches stay in diagnostics');
    assert.equal(sequence, target.pattern.sequences[target.position]);

    // A second stop reuses the same citywide retrieval; the selected stop is never sent.
    await getStopBoard('6');
    assert.deepEqual(requested, ['https://percorsieorari.gtt.to.it/das_gtfsrt/trip_update.aspx']);

    // Realtime failure keeps scheduled rows and backs off through the refresh controller.
    now += 60_000;
    global.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(getStopBoard(CASTELLO), (error: unknown) => error instanceof RealtimeUnavailableError && error.board.rows.length > 0 && error.board.realtime.state === 'unavailable');
    await assert.rejects(getStopBoard('not-a-stop'), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
  } finally { global.fetch = originalFetch; Date.now = originalNow; }
});

test('protobuf-backed alerts retain retrieval time and filter periods at evaluation time', { timeout: 15_000 }, async () => {
  const originalFetch = global.fetch; const originalNow = Date.now;
  const base = serviceTime(day, 9 * 3600); let now = base; let calls = 0;
  const header = { gtfsRealtimeVersion: '2.0', timestamp: (base - 600_000) / 1000 };
  let nextResponse = () => Promise.resolve(new Response(''));
  Date.now = () => now;
  global.fetch = async () => { calls++; return nextResponse(); };
  try {
    const alert = (title: string) => ({ headerText: { translation: [{ text: title, language: 'it' }] }, informedEntity: [{ stopId: CASTELLO }] });
    nextResponse = () => Promise.resolve(response({ header, entity: [
      { id: 'expired-later', alert: { ...alert('Finisce'), activePeriod: [{ end: (base + 10_000) / 1000 }] } },
      { id: 'starts-later', alert: { ...alert('Inizia'), activePeriod: [{ start: (base + 15_000) / 1000 }] } },
      { id: 'other-stop', alert: { ...alert('Altrove'), informedEntity: [{ stopId: '6' }] } },
    ] }));
    const initial = await getTransitAlerts(CASTELLO);
    assert.deepEqual(initial.alerts.map(entry => entry.id), ['expired-later']);
    assert.equal(initial.fetchedAt, base); assert.equal(initial.sourceUpdatedAt, base - 600_000);
    assert.ok(initial.warnings.some(warning => warning.includes('non è aggiornato')));
    now = base + 20_000;
    const cached = await getTransitAlerts(CASTELLO);
    assert.equal(calls, 1); assert.equal(cached.fetchedAt, initial.fetchedAt);
    assert.deepEqual(cached.alerts.map(entry => entry.id), ['starts-later'], 'cached alert periods are evaluated now');
    for (const invalidStop of ['not-installed', '']) {
      await assert.rejects(getTransitAlerts(invalidStop), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    }
    assert.equal(calls, 1, 'invalid stops cannot trigger any transport');
  } finally { global.fetch = originalFetch; Date.now = originalNow; }
});

test('aborted and invalid protobuf retrievals never become cached success', { timeout: 15_000 }, async () => {
  const originalFetch = global.fetch; const originalNow = Date.now;
  let now = serviceTime(day, 10 * 3600); let calls = 0;
  let release!: () => void; let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const transport = new AbortController();
  let nextResponse = () => new Promise<Response>(resolve => { release = () => resolve(response({ header: { gtfsRealtimeVersion: '2.0' } })); });
  Date.now = () => now;
  global.fetch = async () => { calls++; begin(); return nextResponse(); };
  try {
    const first = getStopBoard(CASTELLO, { signal: transport.signal });
    const cancelled = assert.rejects(first, { name: 'AbortError' });
    await started; transport.abort(); await cancelled;
    release(); await setImmediate();
    now += 1_000;
    nextResponse = () => Promise.resolve(new Response(new Uint8Array([255])));
    await assert.rejects(getStopBoard(CASTELLO), (error: unknown) => error instanceof RealtimeUnavailableError && error.kind === 'invalid');
    nextResponse = () => Promise.resolve(response({ header: { gtfsRealtimeVersion: '2.0', incrementality: 'DIFFERENTIAL' } }));
    await assert.rejects(getStopBoard(CASTELLO), (error: unknown) => error instanceof RealtimeUnavailableError && error.kind === 'invalid');
    const callsBefore = calls;
    nextResponse = () => Promise.resolve(response({ header: { gtfsRealtimeVersion: '2.0', timestamp: now / 1000 } }));
    const empty = await getStopBoard(CASTELLO);
    assert.equal(calls, callsBefore + 1, 'failures were not cached');
    assert.equal(empty.realtime.state, 'ok', 'an empty FULL_DATASET is valid, not a mismatch');
    assert.ok(empty.rows.length > 0 && empty.rows.every(row => row.realtimeState === 'scheduled'));
  } finally { transport.abort(); release?.(); global.fetch = originalFetch; Date.now = originalNow; }
});
