import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fetchJSON, fetchResponse, requestQueue, ServiceError } from './network';

function stalledResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
}
const readers = {
  json: (signal?: AbortSignal) => fetchJSON('https://example.test/stalled.json', { signal }),
  binary: async (signal?: AbortSignal) => (await fetchResponse('https://example.test/stalled.pb', { signal })).arrayBuffer(),
};
for (const [format, read] of Object.entries(readers)) {
  test(`${format}: cancellation after headers interrupts a stalled body and releases the provider queue`, async () => {
    const original = global.fetch; const controller = new AbortController(); const queue = requestQueue(0);
    try {
      global.fetch = async () => stalledResponse();
      const pending = queue(() => read(controller.signal), controller.signal);
      const rejection = assert.rejects(pending, { name: 'AbortError' });
      await setImmediate(); await setImmediate(); controller.abort();
      await rejection;
      assert.equal(await queue(async () => 'next request'), 'next request');
    } finally { global.fetch = original; }
  });
  test(`${format}: total request deadline includes a stalled body`, async (context) => {
    const original = global.fetch; context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      global.fetch = async () => stalledResponse();
      const pending = read();
      const rejection = assert.rejects(pending, (error: unknown) => error instanceof ServiceError && error.kind === 'network' && error.message.includes('in tempo'));
      await setImmediate(); await setImmediate(); context.mock.timers.tick(18_001);
      await rejection;
    } finally { global.fetch = original; context.mock.timers.reset(); }
  });
}
test('complete JSON and binary bodies remain readable; malformed JSON stays distinct from network errors', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response('{"ok":true}');
    assert.deepEqual(await fetchJSON('https://example.test'), { ok: true });
    global.fetch = async () => new Response(new Uint8Array([0, 255, 42]));
    assert.deepEqual(new Uint8Array(await (await fetchResponse('https://example.test')).arrayBuffer()), new Uint8Array([0, 255, 42]));
    global.fetch = async () => new Response('{broken');
    await assert.rejects(fetchJSON('https://example.test'), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
  } finally { global.fetch = original; }
});
