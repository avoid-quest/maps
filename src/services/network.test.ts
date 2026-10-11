import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fetchJSON, fetchResponse, requestQueue, ServiceError, wait } from './network';
import { createDiagnosticReport, diagnostics } from './diagnostics';
import { planRoute } from './routing';

function queueClock() {
  let now = 0;
  let pending: { ms: number; resolve: () => void } | undefined;
  const timing = {
    now: () => now,
    wait: (ms: number) => ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => {
      assert.equal(pending, undefined);
      pending = { ms, resolve };
    }),
  };
  return {
    timing,
    setNow(value: number) { now = value; },
    async expectWait(ms: number) { await setImmediate(); assert.equal(pending?.ms, ms); },
    async wakeAt(value: number) {
      assert.ok(pending);
      now = value;
      const { resolve } = pending; pending = undefined; resolve();
      await setImmediate();
    },
  };
}

test('queue rechecks its deadline after every early wake and retains start-to-start spacing', async () => {
  const clock = queueClock(); const queue = requestQueue(20, clock.timing); const starts: number[] = [];
  const request = () => queue(async () => { starts.push(clock.timing.now()); });
  await request();
  const second = request();
  await clock.expectWait(20);
  await clock.wakeAt(15);
  assert.deepEqual(starts, [0]);
  await clock.expectWait(5);
  await clock.wakeAt(19.75);
  assert.deepEqual(starts, [0]);
  await clock.expectWait(0.25);
  await clock.wakeAt(20);
  await second;
  assert.deepEqual(starts, [0, 20]);
});

test('aborting the production wait rejects queued work immediately and leaves the next request usable', async () => {
  let now = 0; let waiting!: () => void;
  const didWait = new Promise<void>((resolve) => { waiting = resolve; });
  const queue = requestQueue(60_000, { now: () => now, wait: (ms, signal) => { if (ms > 0) waiting(); return wait(ms, signal); } });
  await queue(async () => 'first');
  const controller = new AbortController(); let called = false;
  const aborted = assert.rejects(queue(async () => { called = true; }, controller.signal), { name: 'AbortError' });
  await didWait; controller.abort(); await aborted;
  assert.equal(called, false);
  now = 60_000;
  assert.equal(await queue(async () => 'next'), 'next');
});

test('429 backoff begins when failure arrives, survives early wakes, and ordinary failures retain interval spacing', async () => {
  const clock = queueClock(); const queue = requestQueue(20, clock.timing); const starts: number[] = [];
  await assert.rejects(queue(async () => { clock.setNow(7); throw new ServiceError('limited', 'rate-limit'); }), { kind: 'rate-limit' });
  const ordinary = queue(async () => { starts.push(clock.timing.now()); throw new ServiceError('offline'); });
  const rejected = assert.rejects(ordinary, { kind: 'network' });
  await clock.expectWait(60_000);
  await clock.wakeAt(60_006);
  assert.equal(starts.length, 0);
  await clock.expectWait(1);
  await clock.wakeAt(60_007); await rejected;
  const next = queue(async () => { starts.push(clock.timing.now()); });
  await clock.expectWait(20);
  await clock.wakeAt(60_027); await next;
  assert.deepEqual(starts, [60_007, 60_027]);
});

function stalledResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
}
const readers = {
  json: (signal?: AbortSignal) => fetchJSON('https://example.test/stalled.json', { signal }),
  binary: async (signal?: AbortSignal) => (await fetchResponse('https://example.test/stalled.pb', { signal })).arrayBuffer(),
};
for (const [format, read] of Object.entries(readers)) {
  test(`${format}: cancellation after headers interrupts a stalled body and releases the provider queue`, async () => {
    await diagnostics.clear();
    const original = global.fetch; const controller = new AbortController(); const queue = requestQueue(0);
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    try {
      global.fetch = async () => { started(); return stalledResponse(); };
      const pending = queue(() => read(controller.signal), controller.signal);
      const rejection = assert.rejects(pending, { name: 'AbortError' });
      await requestStarted; await setImmediate(); controller.abort();
      await rejection;
      assert.equal(diagnostics.getSnapshot().events.at(-1)?.state, 'cancelled');
      assert.equal(await queue(async () => 'next request'), 'next request');
    } finally { global.fetch = original; }
  });
  test(`${format}: total request deadline includes a stalled body`, async (context) => {
    await diagnostics.clear();
    const original = global.fetch; const originalTimer = global.setTimeout; const originalNow = Date.now;
    context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      global.fetch = async () => stalledResponse();
      const pending = read();
      const rejection = assert.rejects(pending, (error: unknown) => error instanceof ServiceError && error.kind === 'network' && error.message.includes('in tempo'));
      await setImmediate(); await setImmediate(); context.mock.timers.tick(18_001);
      await rejection;
      assert.equal(diagnostics.getSnapshot().events.at(-1)?.state, 'timeout');
    } finally {
      global.fetch = original; context.mock.timers.reset();
      assert.equal(global.setTimeout, originalTimer);
      assert.equal(Date.now, originalNow);
    }
  });
}
test('complete JSON and binary bodies remain readable; malformed JSON stays distinct from network errors', async () => {
  await diagnostics.clear();
  const original = global.fetch;
  try {
    global.fetch = async () => new Response('{"ok":true}');
    assert.deepEqual(await fetchJSON('https://example.test'), { ok: true });
    global.fetch = async () => new Response(new Uint8Array([0, 255, 42]));
    assert.deepEqual(new Uint8Array(await (await fetchResponse('https://example.test')).arrayBuffer()), new Uint8Array([0, 255, 42]));
    global.fetch = async () => new Response('{broken');
    await assert.rejects(fetchJSON('https://example.test'), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    assert.equal(diagnostics.getSnapshot().events.at(-2)?.state, 'ok');
    assert.equal(diagnostics.getSnapshot().events.at(-1)?.state, 'invalid');
  } finally { global.fetch = original; }
});

test('request outcomes retain behavior and never record URL, headers, body or raw errors', async () => {
  await diagnostics.clear();
  const original = global.fetch;
  const secret = 'private-search-12.345678,67.891234-token-do-not-copy';
  const url = `https://example.test/${secret}`;
  const options = { method: 'POST', headers: { Authorization: secret }, body: secret };
  try {
    for (const [status, kind] of [[429, 'rate-limit'], [503, 'unavailable']] as const) {
      global.fetch = async (input, init) => {
        assert.equal(input, url); assert.equal(init?.body, secret);
        assert.equal((init?.headers as Record<string, string>).Authorization, secret);
        return new Response(secret, { status });
      };
      await assert.rejects(fetchJSON(url, options, 'photon'), (error: unknown) => error instanceof ServiceError && error.kind === kind);
      const event = diagnostics.getSnapshot().events.at(-1);
      assert.equal(event?.provider, 'photon'); assert.equal(event?.state, kind); assert.equal(event?.httpStatus, status);
      assert.equal(typeof event?.durationMs, 'number');
    }
    global.fetch = async () => { throw new Error(secret); };
    await assert.rejects(fetchJSON(url, options, 'mato'), (error: unknown) => error instanceof ServiceError && error.kind === 'network');
    assert.equal(diagnostics.getSnapshot().events.at(-1)?.state, 'network');
    const report = createDiagnosticReport(diagnostics.getSnapshot(), {});
    for (const privateText of [secret, 'Authorization', 'example.test', '12.345678', '67.891234']) assert.ok(!report.includes(privateText));
  } finally { global.fetch = original; }
});

test('HTTP 200 with a provider application error records transport success and service failure', async () => {
  await diagnostics.clear();
  const original = global.fetch;
  const privateMessage = 'private-provider-error-12.345678,67.891234';
  try {
    global.fetch = async () => new Response(JSON.stringify({ errors: [{ message: privateMessage }] }));
    await assert.rejects(planRoute({ from: { latitude: 12, longitude: 67 }, to: { latitude: 12.1, longitude: 67.1 }, mode: 'transit' }), (error: unknown) => error instanceof ServiceError && error.kind === 'unavailable');
    assert.deepEqual(diagnostics.getSnapshot().events.map(event => [event.type, event.state, event.provider]), [
      ['request', 'ok', 'mato'], ['service', 'unavailable', 'mato'],
    ]);
    assert.ok(!createDiagnosticReport(diagnostics.getSnapshot(), {}).includes(privateMessage));
  } finally { global.fetch = original; }
});
