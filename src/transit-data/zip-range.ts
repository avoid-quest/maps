import { DecodeUTF8, Inflate } from 'fflate';

/**
 * Ranged reads of a remote ZIP: the central directory from the tail, then only the members we
 * need, inflated as a stream and checked against the directory's CRC-32 and size. Every layer is
 * bounded: transferred bytes per request (checked against Content-Length and while receiving),
 * Content-Range coordinates, directory size and entry count, declared and actual inflated bytes
 * per member and in total, and CSV records and line length. A server that ignores Range, or an
 * archive that changed between requests (If-Range), is refused at the response headers.
 */
export interface RangeResponse { status: number; header(name: string): string | undefined; body: Uint8Array }
/**
 * One GET with the given headers. Implementations must reject without downloading the body when
 * the status is not one of `accept` or the body would exceed `maxBytes`, and must not send or
 * store cookies.
 */
export type RangeTransport = (url: string, headers: Record<string, string>, accept: readonly number[], maxBytes: number) => Promise<RangeResponse>;

export interface ZipEntry { name: string; method: number; crc32: string; compressedSize: number; size: number; offset: number }
export interface CentralDirectory { total: number; etag?: string; lastModified?: string; entries: Map<string, ZipEntry>; bytes: number }

export class ZipRangeError extends Error {
  constructor(message: string, readonly kind: 'changed' | 'unsupported' | 'corrupt' | 'network' | 'limit' = 'corrupt') { super(message); this.name = 'ZipRangeError'; }
}

export interface ZipLimits {
  /** Central directory bytes (GTT: ~1.7 KB). */
  maxDirectoryBytes: number;
  maxEntries: number;
  /** Compressed bytes of one member (GTT trips.txt: ~376 KB). */
  maxCompressedMember: number;
  /** Inflated bytes of one member (GTT trips.txt: ~5.7 MB). */
  maxMemberBytes: number;
  /** Inflated bytes of all members of one read. */
  maxTotalBytes: number;
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxDirectoryBytes: 256 * 1024, maxEntries: 4096, maxCompressedMember: 4 * 1024 * 1024,
  maxMemberBytes: 16 * 1024 * 1024, maxTotalBytes: 24 * 1024 * 1024,
};

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
const TAIL = 8192;
/** Deflate expands at most ~1032:1, so 1 KB of input yields at most ~1 MB per inflate step. */
const INFLATE_STEP = 1024;
/** Yield to the event loop after this much synchronous work. */
const SLICE_MS = 8;

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function contentRange(response: RangeResponse): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.header('content-range') ?? '');
  if (!match) throw new ZipRangeError('Risposta parziale senza Content-Range valido.', 'unsupported');
  const [start, end, total] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!(start <= end && end < total) || response.body.length !== end - start + 1) throw new ZipRangeError('Content-Range e corpo della risposta non coincidono.', 'unsupported');
  return { start, end, total };
}

/** Exactly bytes start..end (inclusive) of an archive of known size and version, or an error. */
async function getRange(transport: RangeTransport, url: string, directory: Pick<CentralDirectory, 'total' | 'etag'>, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end < start || end >= directory.total) throw new ZipRangeError('Intervallo fuori dall’archivio.', 'corrupt');
  const response = await transport(url, { Range: `bytes=${start}-${end}`, ...(directory.etag ? { 'If-Range': directory.etag } : {}) }, [206], end - start + 1);
  const range = contentRange(response);
  if (range.total !== directory.total) throw new ZipRangeError('L’archivio GTT è cambiato durante la lettura.', 'changed');
  if (range.start !== start || range.end !== end) throw new ZipRangeError('Intervallo restituito diverso da quello richiesto.', 'unsupported');
  return response.body;
}

/**
 * Read the end-of-central-directory record and the central directory. With `ifNoneMatch`, a 304
 * means the archive is unchanged and nothing else is transferred.
 */
export async function readCentralDirectory(transport: RangeTransport, url: string, ifNoneMatch?: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<CentralDirectory | 'not-modified'> {
  const tail = await transport(url, { Range: `bytes=-${TAIL}`, ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}) }, [206, 304], TAIL);
  if (tail.status === 304) return 'not-modified';
  const range = contentRange(tail);
  if (range.end !== range.total - 1) throw new ZipRangeError('La coda dell’archivio non termina alla fine del file.', 'unsupported');
  const { total } = range;
  const etag = tail.header('etag'); const lastModified = tail.header('last-modified');
  let eocd = -1;
  for (let at = tail.body.length - 22; at >= 0; at--) if (u32(tail.body, at) === 0x06054b50) { eocd = at; break; }
  if (eocd < 0) throw new ZipRangeError('Fine dell’archivio ZIP non trovata.', 'unsupported');
  const count = u16(tail.body, eocd + 10); const size = u32(tail.body, eocd + 12); const offset = u32(tail.body, eocd + 16);
  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff) throw new ZipRangeError('ZIP64 non supportato.', 'unsupported');
  const eocdAt = range.start + eocd;
  if (count > limits.maxEntries || size > limits.maxDirectoryBytes || size < count * 46 || offset + size > eocdAt) {
    throw new ZipRangeError('Directory centrale ZIP fuori dai limiti.', 'limit');
  }
  let directory: Uint8Array; let bytes = tail.body.length;
  if (offset >= range.start) directory = tail.body.subarray(offset - range.start, offset - range.start + size);
  else { directory = await getRange(transport, url, { total, etag }, offset, offset + size - 1); bytes += directory.length; }
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || u32(directory, at) !== 0x02014b50) throw new ZipRangeError('Directory centrale ZIP non valida.');
    const nameLength = u16(directory, at + 28); const extra = u16(directory, at + 30); const comment = u16(directory, at + 32);
    if (at + 46 + nameLength > directory.length) throw new ZipRangeError('Directory centrale ZIP non valida.');
    let name = '';
    for (let char = 0; char < nameLength; char++) name += String.fromCharCode(directory[at + 46 + char]!);
    const entry: ZipEntry = {
      name, method: u16(directory, at + 10), crc32: hex32(u32(directory, at + 16)),
      compressedSize: u32(directory, at + 20), size: u32(directory, at + 24), offset: u32(directory, at + 42),
    };
    if (entry.offset + 30 + nameLength + entry.compressedSize > offset) throw new ZipRangeError(`${name}: voce fuori dall’archivio.`);
    entries.set(name, entry);
    at += 46 + nameLength + extra + comment;
  }
  return { total, etag, lastModified, entries, bytes };
}

/**
 * Fetch members (adjacent ones in one request), inflate each as a bounded stream into text
 * chunks, and verify CRC-32 and size. Consumers may parse chunks as they arrive, but must discard
 * everything when this rejects.
 */
export async function readMembers(transport: RangeTransport, url: string, directory: CentralDirectory, names: readonly string[],
  onText: (name: string, chunk: string, final: boolean) => void, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<number> {
  const wanted = names.map(name => {
    const entry = directory.entries.get(name);
    if (!entry) throw new ZipRangeError(`${name} assente nell’archivio GTT.`);
    if (entry.method !== 0 && entry.method !== 8) throw new ZipRangeError(`${name}: formato non supportato.`, 'unsupported');
    // A deflated member always has at least one block: an empty one is malformed.
    if (entry.method === 8 && entry.compressedSize === 0) throw new ZipRangeError(`${name}: dati compressi vuoti.`);
    if (entry.compressedSize > limits.maxCompressedMember || entry.size > limits.maxMemberBytes || (entry.method === 0 && entry.compressedSize !== entry.size)) {
      throw new ZipRangeError(`${name}: dimensioni dichiarate fuori dai limiti.`, 'limit');
    }
    return entry;
  }).sort((a, b) => a.offset - b.offset);
  if (wanted.reduce((sum, entry) => sum + entry.size, 0) > limits.maxTotalBytes) throw new ZipRangeError('Dati GTT richiesti fuori dai limiti.', 'limit');
  // Local headers repeat the name and may carry their own extra field; allow slack, then re-read if short.
  const span = (entry: ZipEntry) => [entry.offset, entry.offset + 30 + entry.name.length + 256 + entry.compressedSize] as const;
  const groups: ZipEntry[][] = [];
  for (const entry of wanted) {
    const last = groups.at(-1);
    if (last && span(entry)[0] - span(last.at(-1)!)[1] < 64 * 1024) last.push(entry); else groups.push([entry]);
  }
  let bytes = 0; const budget = { total: 0 };
  for (const group of groups) {
    const start = span(group[0]!)[0]; const end = Math.min(directory.total, span(group.at(-1)!)[1]) - 1;
    const body = await getRange(transport, url, directory, start, end);
    bytes += body.length;
    for (const entry of group) {
      const local = entry.offset - start;
      if (local + 30 > body.length || u32(body, local) !== 0x04034b50) throw new ZipRangeError(`${entry.name}: intestazione locale non valida.`);
      const dataStart = local + 30 + u16(body, local + 26) + u16(body, local + 28);
      let data = body.subarray(dataStart, dataStart + entry.compressedSize);
      if (data.length < entry.compressedSize) {
        const rest = await getRange(transport, url, directory, start + dataStart + data.length, start + dataStart + entry.compressedSize - 1);
        bytes += rest.length;
        const joined = new Uint8Array(entry.compressedSize); joined.set(data); joined.set(rest, data.length); data = joined;
      }
      await inflateMember(entry, data, (chunk, final) => onText(entry.name, chunk, final), limits, budget);
    }
  }
  return bytes;
}

/**
 * Inflates in 1 KB input steps (so no step can produce more than ~1 MB), aborting as soon as the
 * member exceeds its declared size, the per-member limit or the read's total budget, and yields
 * to the event loop every few milliseconds so a board stays responsive.
 */
async function inflateMember(entry: ZipEntry, data: Uint8Array, onText: (chunk: string, final: boolean) => void, limits: ZipLimits, budget: { total: number }) {
  let crc = 0; let size = 0;
  const decoder = new DecodeUTF8((text, final) => onText(text, final));
  const sink = (chunk: Uint8Array, final: boolean) => {
    size += chunk.length; budget.total += chunk.length;
    if (size > entry.size || size > limits.maxMemberBytes || budget.total > limits.maxTotalBytes) throw new ZipRangeError(`${entry.name}: dati decompressi oltre i limiti.`, 'limit');
    crc = crc32(chunk, crc); decoder.push(chunk, final);
  };
  try {
    if (entry.method === 0) {
      for (let at = 0; at < data.length; at += 64 * 1024) { sink(data.subarray(at, at + 64 * 1024), at + 64 * 1024 >= data.length); await yieldToEventLoop(); }
      if (!data.length) sink(data, true);
    } else {
      const inflate = new Inflate(sink);
      let sliceStart = Date.now();
      for (let at = 0; at < data.length; at += INFLATE_STEP) {
        inflate.push(data.subarray(at, at + INFLATE_STEP), at + INFLATE_STEP >= data.length);
        if (Date.now() - sliceStart >= SLICE_MS) { await yieldToEventLoop(); sliceStart = Date.now(); }
      }
    }
  } catch (error) {
    if (error instanceof ZipRangeError) throw error;
    throw new ZipRangeError(`${entry.name}: dati compressi non validi.`);
  }
  if (size !== entry.size || hex32(crc) !== entry.crc32) throw new ZipRangeError(`${entry.name}: CRC o dimensione non corrispondenti.`);
}

export interface CsvLimits { maxRows: number; maxLineLength: number }
/**
 * Streaming CSV rows (RFC 4180 quoting, BOM stripped); `onRow` receives the header-keyed record.
 * Throws as soon as a record count or line length limit is exceeded.
 */
export function csvRows(onRow: (row: Record<string, string>) => void, limits: CsvLimits = { maxRows: 1_000_000, maxLineLength: 64 * 1024 }) {
  let buffer = ''; let header: string[] | undefined; let first = true; let rows = 0;
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
    if (++rows > limits.maxRows) throw new ZipRangeError('Troppi record CSV.', 'limit');
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
      else if (char === '\n' && !quoted) {
        if (index - lineStart > limits.maxLineLength) throw new ZipRangeError('Riga CSV troppo lunga.', 'limit');
        emit(buffer.slice(lineStart, index).replace(/\r$/, '')); lineStart = index + 1;
      }
    }
    buffer = buffer.slice(lineStart); scanned = buffer.length;
    if (buffer.length > limits.maxLineLength) throw new ZipRangeError('Riga CSV troppo lunga.', 'limit');
    if (final && quoted) throw new ZipRangeError('Campo CSV tra virgolette non chiuso.');
    if (final && buffer) { emit(buffer.replace(/\r$/, '')); buffer = ''; scanned = 0; }
  };
}
