import { DecodeUTF8, Inflate } from 'fflate';

/**
 * Ranged reads of a remote ZIP: the central directory from the tail, then only the members we
 * need, inflated as a stream and checked against the directory's CRC-32 and size. Never reads a
 * full-body (200) response: a server that ignores Range, or an entity that changed between
 * requests (If-Range), aborts the transfer at the headers.
 */
export interface RangeResponse { status: number; header(name: string): string | undefined; body: Uint8Array }
/**
 * One GET with the given headers. Implementations must reject without downloading the body
 * when the status is not one of `accept`, and must not send or store cookies.
 */
export type RangeTransport = (url: string, headers: Record<string, string>, accept: readonly number[]) => Promise<RangeResponse>;

export interface ZipEntry { name: string; method: number; crc32: string; compressedSize: number; size: number; offset: number }
export interface CentralDirectory { total: number; etag?: string; lastModified?: string; entries: Map<string, ZipEntry>; bytes: number }

export class ZipRangeError extends Error {
  constructor(message: string, readonly kind: 'changed' | 'unsupported' | 'corrupt' | 'network' = 'corrupt') { super(message); this.name = 'ZipRangeError'; }
}

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
/** Incremental CRC-32 (IEEE); start with 0. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let index = 0; index < data.length; index++) c = TABLE[(c ^ data[index]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
export const hex32 = (value: number) => value.toString(16).padStart(8, '0');

const u16 = (data: Uint8Array, at: number) => data[at]! | (data[at + 1]! << 8);
const u32 = (data: Uint8Array, at: number) => (data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16) | (data[at + 3]! << 24)) >>> 0;
const MAX_MEMBER = 4 * 1024 * 1024;
const TAIL = 8192;

function totalFrom(response: RangeResponse): number {
  const match = /\/(\d+)$/.exec(response.header('content-range') ?? '');
  if (!match) throw new ZipRangeError('Risposta parziale senza Content-Range.', 'unsupported');
  return Number(match[1]);
}

/**
 * Read the end-of-central-directory record and the central directory. With `ifNoneMatch`, a 304
 * means the archive is unchanged and nothing else is transferred.
 */
export async function readCentralDirectory(transport: RangeTransport, url: string, ifNoneMatch?: string): Promise<CentralDirectory | 'not-modified'> {
  const tail = await transport(url, { Range: `bytes=-${TAIL}`, ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}) }, [206, 304]);
  if (tail.status === 304) return 'not-modified';
  const total = totalFrom(tail);
  const etag = tail.header('etag'); const lastModified = tail.header('last-modified');
  const tailStart = total - tail.body.length;
  let eocd = -1;
  for (let at = tail.body.length - 22; at >= 0; at--) if (u32(tail.body, at) === 0x06054b50) { eocd = at; break; }
  if (eocd < 0) throw new ZipRangeError('Fine dell’archivio ZIP non trovata.', 'unsupported');
  const count = u16(tail.body, eocd + 10); const size = u32(tail.body, eocd + 12); const offset = u32(tail.body, eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new ZipRangeError('ZIP64 non supportato.', 'unsupported');
  let directory: Uint8Array; let bytes = tail.body.length;
  if (offset >= tailStart) directory = tail.body.subarray(offset - tailStart, offset - tailStart + size);
  else {
    const response = await transport(url, { Range: `bytes=${offset}-${offset + size - 1}`, ...(etag ? { 'If-Range': etag } : {}) }, [206]);
    directory = response.body; bytes += response.body.length;
  }
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (u32(directory, at) !== 0x02014b50) throw new ZipRangeError('Directory centrale ZIP non valida.');
    const nameLength = u16(directory, at + 28); const extra = u16(directory, at + 30); const comment = u16(directory, at + 32);
    let name = '';
    for (let char = 0; char < nameLength; char++) name += String.fromCharCode(directory[at + 46 + char]!);
    entries.set(name, {
      name, method: u16(directory, at + 10), crc32: hex32(u32(directory, at + 16)),
      compressedSize: u32(directory, at + 20), size: u32(directory, at + 24), offset: u32(directory, at + 42),
    });
    at += 46 + nameLength + extra + comment;
  }
  return { total, etag, lastModified, entries, bytes };
}

/**
 * Fetch members (adjacent ones in one request), inflate each as a stream into text chunks,
 * and verify CRC-32 and size. `If-Range` pins every request to the directory's version.
 */
export async function readMembers(transport: RangeTransport, url: string, directory: CentralDirectory, names: readonly string[],
  onText: (name: string, chunk: string, final: boolean) => void): Promise<number> {
  const wanted = names.map(name => {
    const entry = directory.entries.get(name);
    if (!entry) throw new ZipRangeError(`${name} assente nell’archivio GTT.`);
    if (entry.compressedSize > MAX_MEMBER || (entry.method !== 0 && entry.method !== 8)) throw new ZipRangeError(`${name}: formato non supportato.`, 'unsupported');
    return entry;
  }).sort((a, b) => a.offset - b.offset);
  // Local headers repeat the name and may carry their own extra field; allow slack, then re-read if short.
  const span = (entry: ZipEntry) => [entry.offset, entry.offset + 30 + entry.name.length + 256 + entry.compressedSize] as const;
  const groups: ZipEntry[][] = [];
  for (const entry of wanted) {
    const last = groups.at(-1);
    if (last && span(entry)[0] - span(last.at(-1)!)[1] < 64 * 1024) last.push(entry); else groups.push([entry]);
  }
  let bytes = 0;
  for (const group of groups) {
    const start = span(group[0]!)[0]; const end = Math.min(directory.total, span(group.at(-1)!)[1]) - 1;
    const response = await transport(url, { Range: `bytes=${start}-${end}`, ...(directory.etag ? { 'If-Range': directory.etag } : {}) }, [206]);
    if (totalFrom(response) !== directory.total) throw new ZipRangeError('L’archivio GTT è cambiato durante la lettura.', 'changed');
    bytes += response.body.length;
    for (const entry of group) {
      const local = entry.offset - start;
      if (u32(response.body, local) !== 0x04034b50) throw new ZipRangeError(`${entry.name}: intestazione locale non valida.`);
      const dataStart = local + 30 + u16(response.body, local + 26) + u16(response.body, local + 28);
      let data = response.body.subarray(dataStart, dataStart + entry.compressedSize);
      if (data.length < entry.compressedSize) {
        const from = start + dataStart + data.length;
        const rest = await transport(url, { Range: `bytes=${from}-${start + dataStart + entry.compressedSize - 1}`, ...(directory.etag ? { 'If-Range': directory.etag } : {}) }, [206]);
        bytes += rest.body.length;
        const joined = new Uint8Array(entry.compressedSize); joined.set(data); joined.set(rest.body, data.length); data = joined;
      }
      await inflateMember(entry, data, (chunk, final) => onText(entry.name, chunk, final));
    }
  }
  return bytes;
}

/** Inflates in 16 KB compressed steps, yielding to the event loop between steps so a board stays responsive. */
async function inflateMember(entry: ZipEntry, data: Uint8Array, onText: (chunk: string, final: boolean) => void) {
  let crc = 0; let size = 0;
  const decoder = new DecodeUTF8((text, final) => onText(text, final));
  const sink = (chunk: Uint8Array, final: boolean) => { crc = crc32(chunk, crc); size += chunk.length; decoder.push(chunk, final); };
  try {
    if (entry.method === 0) sink(data, true);
    else {
      const inflate = new Inflate(sink);
      const step = 16 * 1024;
      for (let at = 0; at < data.length; at += step) {
        inflate.push(data.subarray(at, at + step), at + step >= data.length);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    if (error instanceof ZipRangeError) throw error;
    throw new ZipRangeError(`${entry.name}: dati compressi non validi.`);
  }
  if (size !== entry.size || hex32(crc) !== entry.crc32) throw new ZipRangeError(`${entry.name}: CRC o dimensione non corrispondenti.`);
}

/** Streaming CSV rows (RFC 4180 quoting, BOM stripped); `onRow` receives the header-keyed record. */
export function csvRows(onRow: (row: Record<string, string>) => void) {
  let buffer = ''; let header: string[] | undefined; let first = true;
  const parse = (line: string): string[] => {
    const fields: string[] = []; let field = ''; let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index]!;
      if (quoted) {
        if (char === '"') { if (line[index + 1] === '"') { field += '"'; index++; } else quoted = false; } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { fields.push(field); field = ''; } else field += char;
    }
    fields.push(field);
    return fields;
  };
  const emit = (line: string) => {
    if (first) { line = line.replace(/^﻿/, ''); first = false; }
    if (!line) return;
    const fields = parse(line);
    if (!header) { header = fields.map(field => field.trim()); return; }
    const row: Record<string, string> = {};
    header.forEach((name, index) => { row[name] = fields[index] ?? ''; });
    onRow(row);
  };
  let scanned = 0; let quoted = false;
  return (chunk: string, final: boolean) => {
    buffer += chunk;
    let lineStart = 0;
    // Split only at newlines outside quotes, so quoted fields may contain line breaks.
    for (let index = scanned; index < buffer.length; index++) {
      const char = buffer[index];
      if (char === '"') quoted = !quoted;
      else if (char === '\n' && !quoted) { emit(buffer.slice(lineStart, index).replace(/\r$/, '')); lineStart = index + 1; }
    }
    buffer = buffer.slice(lineStart); scanned = buffer.length;
    if (final && buffer) { emit(buffer.replace(/\r$/, '')); buffer = ''; scanned = 0; }
  };
}
