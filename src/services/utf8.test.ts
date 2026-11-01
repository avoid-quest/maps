import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJSON } from './network';
import { decodeUtf8 } from './utf8';

const sample = '{"name":"Vrù - Cantoira","city":"Torino è","emoji":"🚋","quote":"“Mole”"}';
const bytes = new TextEncoder().encode(sample);
/** What React Native's whatwg-fetch does to a buffered body: one byte per character. */
const latin1 = (input: Uint8Array) => Array.from(input, byte => String.fromCharCode(byte)).join('');

test('UTF-8 bodies keep accented, typographic and astral characters', () => {
  assert.equal(latin1(bytes).includes('VrÃ¹'), true, 'the polyfill behaviour reproduces the reported mojibake');
  assert.equal(decodeUtf8(bytes), sample);
  assert.equal(decodeUtf8(bytes, null), sample, 'the fallback decoder matches TextDecoder');
  assert.equal(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]), null), sample, 'a byte-order mark is ignored');
  assert.equal(decodeUtf8(new Uint8Array([0x61, 0xc3, 0x28, 0xe2, 0x82, 0x62, 0xff]), null), new TextDecoder().decode(new Uint8Array([0x61, 0xc3, 0x28, 0xe2, 0x82, 0x62, 0xff])), 'malformed input follows the WHATWG replacement rules');
  const malformed = new Uint8Array(300_000).fill(0xff);
  assert.equal(decodeUtf8(malformed, null), '\uFFFD'.repeat(300_000), 'long malformed runs flush instead of overflowing the argument list');
  const long = 'àèìòù'.repeat(5000);
  assert.equal(decodeUtf8(new TextEncoder().encode(long), null), long);
});

test('fetchJSON decodes service JSON as UTF-8 even when Response.text() would not', async () => {
  const original = global.fetch;
  const { text, json } = Response.prototype;
  try {
    // Simulate React Native's polyfill, whose text()/json() read buffered bytes as Latin-1.
    Response.prototype.text = async function () { return latin1(new Uint8Array(await this.arrayBuffer())); };
    Response.prototype.json = async function () { return JSON.parse(await this.text()); };
    global.fetch = (async () => new Response(bytes, { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const result = await fetchJSON<{ name: string; emoji: string }>('https://example.test/photon');
    assert.equal(result.name, 'Vrù - Cantoira');
    assert.equal(result.emoji, '🚋');
  } finally {
    global.fetch = original;
    Response.prototype.text = text;
    Response.prototype.json = json;
  }
});
