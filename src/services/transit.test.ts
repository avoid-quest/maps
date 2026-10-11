import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import { getDepartures, getTransitAlerts } from './transit';
import { ServiceError } from './network';

const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
const response = (feed: unknown) => new Response(Feed.encode(Feed.fromObject(feed as object)).finish() as unknown as BodyInit);

test('protobuf-backed retrievals retain original cache timestamps while filtering and aging at evaluation time', { timeout: 15_000 }, async () => {
  const originalFetch = global.fetch; const originalNow = Date.now;
  const base = Math.floor((Date.now() - 3_600_000) / 1000) * 1000; let now = base; let calls = 0;
  const source = base - 110_000;
  const header = { gtfsRealtimeVersion: '2.0', timestamp: source / 1000 };
  const feed = {
    header, entity: [{ id: 'trip', tripUpdate: { timestamp: source / 1000, trip: { tripId: '28396716U' }, stopTimeUpdate: [
      { stopSequence: 9, arrival: { time: (base - 55_000) / 1000 } },
      { stopId: '6', stopSequence: 99, arrival: { time: (base + 120_000) / 1000 } },
    ] } }],
  };
  let release!: () => void;
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const controller = new AbortController(); const pending: Promise<unknown>[] = [];
  let nextResponse = () => Promise.resolve(response(feed));
  Date.now = () => now;
  global.fetch = async () => { calls++; begin(); return nextResponse(); };
  try {
    nextResponse = () => new Promise<Response>(resolve => { release = () => resolve(response(feed)); });
    const first = getDepartures('6', { signal: controller.signal }); const queued = getDepartures('6', { signal: controller.signal });
    pending.push(first, queued);
    await started; assert.equal(calls, 1);
    now = base + 5_000; release();
    const board = await first;
    assert.equal(board.fetchedAt, base + 5_000, 'retrieval completes after the body has arrived');
    assert.equal(board.sourceUpdatedAt, source, 'provider timestamp remains separate');
    assert.equal(board.departures.length, 2); assert.equal(board.departures[1]?.status, 'live');
    now = base + 15_000;
    const queuedBoard = await queued;
    assert.equal(calls, 1, 'queue rechecks the cache after the first retrieval');
    assert.equal(queuedBoard.fetchedAt, board.fetchedAt);
    assert.equal(queuedBoard.departures.length, 1, 'expired departures are filtered at current time');
    assert.equal(queuedBoard.departures[0]?.status, 'stale', 'cached predictions age independently of retrieval');
    now += 5_000;
    const cachedBoard = await getDepartures('6');
    assert.equal(cachedBoard.fetchedAt, board.fetchedAt); assert.equal(calls, 1);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(getDepartures('6', { signal: cancelled.signal }), { name: 'AbortError' });
    assert.equal(calls, 1, 'even cached retrieval respects cancellation');

    now = base + 36_000;
    nextResponse = () => Promise.resolve(new Response('', { status: 503 }));
    await assert.rejects(getDepartures('6'), (error: unknown) => error instanceof ServiceError && error.kind === 'unavailable');
    assert.equal(calls, 2); assert.equal(board.fetchedAt, base + 5_000);
    now = base + 37_000; nextResponse = () => Promise.resolve(response(feed));
    const renewed = await getDepartures('6');
    assert.equal(calls, 3, 'failed retrieval does not make the old cache fresh');
    assert.equal(renewed.fetchedAt, now); assert.equal(renewed.sourceUpdatedAt, source);

    now = base + 40_000;
    const alert = (title: string) => ({ headerText: { translation: [{ text: title, language: 'it' }] }, informedEntity: [{ stopId: '6' }] });
    nextResponse = () => Promise.resolve(response({ header: { ...header, timestamp: (base - 600_000) / 1000 }, entity: [
      { id: 'expired-later', alert: { ...alert('Finisce'), activePeriod: [{ end: (base + 50_000) / 1000 }] } },
      { id: 'starts-later', alert: { ...alert('Inizia'), activePeriod: [{ start: (base + 55_000) / 1000 }] } },
      { id: 'other-stop', alert: { ...alert('Altrove'), informedEntity: [{ stopId: '10' }] } },
    ] }));
    const initialAlerts = await getTransitAlerts('6');
    assert.deepEqual(initialAlerts.alerts.map(alert => alert.id), ['expired-later']);
    assert.equal(initialAlerts.fetchedAt, now); assert.equal(initialAlerts.sourceUpdatedAt, base - 600_000);
    assert.ok(initialAlerts.warnings.some(warning => warning.includes('non è aggiornato')));
    now = base + 60_000;
    const cachedAlerts = await getTransitAlerts('6');
    assert.equal(calls, 4); assert.equal(cachedAlerts.fetchedAt, initialAlerts.fetchedAt);
    assert.deepEqual(cachedAlerts.alerts.map(alert => alert.id), ['starts-later'], 'cached alert periods are evaluated now');
    for (const invalidStop of ['not-installed', '']) {
      await assert.rejects(getDepartures(invalidStop), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
      await assert.rejects(getTransitAlerts(invalidStop), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    }
    assert.equal(calls, 4, 'invalid stops cannot trigger any transport');
    for (const timestamp of [undefined, (base + 3_600_000) / 1000]) {
      now += 301_000;
      nextResponse = () => Promise.resolve(response({ header: { gtfsRealtimeVersion: '2.0', timestamp }, entity: [] }));
      const uncertain = await getTransitAlerts('6');
      assert.deepEqual(uncertain.alerts, [], 'an empty full dataset is a valid alert snapshot');
      assert.equal(uncertain.fetchedAt, now);
      assert.equal(uncertain.sourceUpdatedAt, timestamp === undefined ? undefined : timestamp * 1000);
      assert.ok(uncertain.warnings.some(warning => warning.includes('non è verificabile')), 'missing/future source time cannot establish freshness');
    }
  } finally {
    controller.abort(); release?.(); await Promise.allSettled(pending);
    global.fetch = originalFetch; Date.now = originalNow;
  }
});

test('aborted and invalid protobuf retrievals never become cached success', { timeout: 15_000 }, async () => {
  const originalFetch = global.fetch; const originalNow = Date.now;
  const base = Math.floor((Date.now() - 7_200_000) / 1000) * 1000; let now = base; let calls = 0;
  let release!: () => void;
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const transport = new AbortController(); const queued = new AbortController();
  let nextResponse = () => new Promise<Response>(resolve => { release = () => resolve(response({ header: { gtfsRealtimeVersion: '2.0' } })); });
  Date.now = () => now;
  global.fetch = async () => { calls++; begin(); return nextResponse(); };
  try {
    const first = getDepartures('6', { signal: transport.signal });
    const second = getDepartures('6', { signal: queued.signal });
    const cancelled = Promise.all([
      assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' }),
    ]);
    await started;
    assert.equal(calls, 1);
    transport.abort(); queued.abort(); await cancelled;
    release(); await setImmediate();
    assert.equal(calls, 1, 'aborted queued work cannot reach the provider');

    nextResponse = () => Promise.resolve(new Response(new Uint8Array([255])));
    await assert.rejects(getDepartures('6'), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    assert.equal(calls, 2, 'late aborted completion cannot populate the cache');
    nextResponse = () => Promise.resolve(response({ header: { gtfsRealtimeVersion: '2.0', incrementality: 'DIFFERENTIAL' } }));
    await assert.rejects(getDepartures('6'), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    assert.equal(calls, 3, 'malformed retrieval is not cached');
    now += 1_000;
    nextResponse = () => Promise.resolve(response({ header: { gtfsRealtimeVersion: '2.0', timestamp: base / 1000 } }));
    const empty = await getDepartures('6');
    assert.equal(calls, 4, 'unsupported differential retrieval is not cached');
    assert.deepEqual(empty.departures, []);
    assert.equal(empty.fetchedAt, now); assert.equal(empty.sourceUpdatedAt, base);
    assert.ok(empty.warnings.some(warning => warning.includes('Nessuna previsione')));
  } finally { transport.abort(); queued.abort(); release?.(); global.fetch = originalFetch; Date.now = originalNow; }
});
