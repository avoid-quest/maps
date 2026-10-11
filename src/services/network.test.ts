import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fetchJSON, fetchResponse, requestQueue, ServiceError } from './network';
import { createDiagnosticReport, diagnostics } from './diagnostics';
import { planRoute } from './routing';

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
    const original = global.fetch; context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      global.fetch = async () => stalledResponse();
      const pending = read();
      const rejection = assert.rejects(pending, (error: unknown) => error instanceof ServiceError && error.kind === 'network' && error.message.includes('in tempo'));
      await setImmediate(); await setImmediate(); context.mock.timers.tick(18_001);
      await rejection;
      assert.equal(diagnostics.getSnapshot().events.at(-1)?.state, 'timeout');
    } finally { global.fetch = original; context.mock.timers.reset(); }
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
