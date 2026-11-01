/**
 * Decodes UTF-8 bytes. React Native's fetch polyfill (whatwg-fetch) turns an ArrayBuffer body into text
 * one byte per character (Latin-1), so "Vrù" arrived as "VrÃ¹". JSON is UTF-8 by definition (RFC 8259),
 * so service bodies are decoded here instead of through Response.text()/json().
 */
export function decodeUtf8(input: ArrayBuffer | Uint8Array, decoder: ((bytes: Uint8Array) => string) | null = nativeDecoder()): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = start ? bytes.subarray(start) : bytes;
  return decoder ? decoder(body) : decodeManually(body);
}

function nativeDecoder(): ((bytes: Uint8Array) => string) | null {
  if (typeof TextDecoder !== 'function') return null;
  try {
    const decoder = new TextDecoder('utf-8');
    return bytes => decoder.decode(bytes);
  } catch { return null; }
}

/** WHATWG-compatible UTF-8 decoding with U+FFFD for malformed sequences, for runtimes without TextDecoder. */
function decodeManually(bytes: Uint8Array): string {
  const units: number[] = [];
  let out = '';
  const flush = () => { out += String.fromCharCode(...units); units.length = 0; };
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!;
    let needed = 0; let code = 0; let lower = 0x80; let upper = 0xbf;
    if (first < 0x80) { units.push(first); index += 1; if (units.length > 4096) flush(); continue; }
    if (first >= 0xc2 && first <= 0xdf) { needed = 1; code = first & 0x1f; }
    else if (first >= 0xe0 && first <= 0xef) { needed = 2; code = first & 0x0f; if (first === 0xe0) lower = 0xa0; if (first === 0xed) upper = 0x9f; }
    else if (first >= 0xf0 && first <= 0xf4) { needed = 3; code = first & 0x07; if (first === 0xf0) lower = 0x90; if (first === 0xf4) upper = 0x8f; }
    else { units.push(0xfffd); index += 1; if (units.length > 4096) flush(); continue; }
    let consumed = 1;
    for (; consumed <= needed; consumed++) {
      const next = bytes[index + consumed];
      if (next === undefined || next < lower || next > upper) break;
      code = (code << 6) | (next & 0x3f);
      lower = 0x80; upper = 0xbf;
    }
    if (consumed <= needed) { units.push(0xfffd); index += consumed; if (units.length > 4096) flush(); continue; }
    index += consumed;
    if (code > 0xffff) { code -= 0x10000; units.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff)); }
    else units.push(code);
    if (units.length > 4096) flush();
  }
  flush();
  return out;
}
