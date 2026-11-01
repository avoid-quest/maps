import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createRemapService, createSqlRemapStore, createMemoryRemapStore, lazyRemapStore, REMAP_POLICY } from './remap';
import { createBunDriver } from './test-support/sqlite-driver';
import { crc32, csvRows, hex32, readCentralDirectory, readMembers, ZipRangeError, type RangeTransport } from './zip-range';

const TRIPS_HEADER = 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n';
function archive(version: string, tripCount = 1500) {
  let trips = TRIPS_HEADER;
  for (let index = 0; index < tripCount; index++) trips += `4U,SVC${index % 3},${version}-${index},"CORSO, X",${index % 2},b${index},4A${index % 2}\n`;
  return zipSync({
    'agency.txt': strToU8('agency_id,agency_name\nU,GTT\n'),
    'calendar.txt': strToU8('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC0,1,1,1,1,1,0,0,20261001,20261231\n'),
    'calendar_dates.txt': strToU8('service_id,date,exception_type\nSVC1,20261102,1\nSVC0,20261102,2\n'),
    // Incompressible filler: the large member a remap must never download.
    'stop_times.txt': (() => { let seed = 7; return new Uint8Array(200_000).map(() => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24); })(),
    'trips.txt': strToU8(trips),
    'feed_info.txt': strToU8(`feed_publisher_name,feed_version\nGTT,${version}\n`),
  }, { level: 6 });
}

/** A static server: Range (suffix and a-b), ETag, If-None-Match and If-Range, like GTT's Apache. */
function server(initial: Uint8Array) {
  let body = initial; let etag = '"v1"'; const log: { headers: Record<string, string>; status: number; bytes: number }[] = [];
  const transport: RangeTransport = async (_url, headers, accept, maxBytes) => {
    let status = 206; let slice = body;
    if (headers['If-None-Match'] === etag) status = 304;
    else if (headers['If-Range'] && headers['If-Range'] !== etag) status = 200;
    else {
      const suffix = /^bytes=-(\d+)$/.exec(headers.Range ?? ''); const span = /^bytes=(\d+)-(\d+)$/.exec(headers.Range ?? '');
      if (suffix) slice = body.subarray(Math.max(0, body.length - Number(suffix[1])));
      else if (span) slice = body.subarray(Number(span[1]), Number(span[2]) + 1);
      else status = 200;
    }
    const start = status === 206 ? (slice.byteOffset - body.byteOffset) : 0;
    // Like the XHR transport: an unexpected status or oversized body is rejected at the headers.
    const oversized = status !== 304 && slice.length > maxBytes;
    const refused = !accept.includes(status) || oversized;
    log.push({ headers, status, bytes: refused || status === 304 ? 0 : slice.length });
    if (!accept.includes(status)) throw new ZipRangeError(`HTTP ${status}`, status === 200 ? 'changed' : 'unsupported');
    if (oversized) throw new ZipRangeError('too large', 'limit');
    // Headers are snapshotted when the response is produced, like a real HTTP response.
    const responseHeaders = { etag, 'last-modified': 'Sun, 01 Nov 2026 02:26:59 GMT', 'content-range': `bytes ${start}-${start + slice.length - 1}/${body.length}` } as Record<string, string>;
    return { status, body: status === 304 ? new Uint8Array() : slice, header: (name: string) => responseHeaders[name.toLowerCase()] };
  };
  return { transport, log, replace(next: Uint8Array, tag: string) { body = next; etag = tag; } };
}

test('CRC-32 and the streaming CSV parser handle quotes, CRLF, BOM and chunk boundaries', () => {
  assert.equal(hex32(crc32(strToU8('123456789'))), 'cbf43926');
  const rows: Record<string, string>[] = [];
  const push = csvRows(row => rows.push(row));
  const text = '﻿a,b\r\n1,"x, ""y"""\r\n2,"multi\nline"\n3,z';
  for (let at = 0; at < text.length; at += 3) push(text.slice(at, at + 3), at + 3 >= text.length);
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"' }, { a: '2', b: 'multi\nline' }, { a: '3', b: 'z' }]);
});

test('ranged reads fetch only the directory and requested members, verified by CRC', async () => {
  const zip = archive('20261101');
  const { transport, log } = server(zip);
  const directory = await readCentralDirectory(transport, 'zip', undefined);
  assert.notEqual(directory, 'not-modified');
  if (directory === 'not-modified') return;
  assert.equal(directory.entries.get('stop_times.txt')?.size, 200_000);
  const text: Record<string, string> = {};
  const bytes = await readMembers(transport, 'zip', directory, ['trips.txt', 'calendar.txt'], (name, chunk) => { text[name] = (text[name] ?? '') + chunk; });
  assert.ok(text['trips.txt']!.startsWith(TRIPS_HEADER));
  assert.ok(bytes + directory.bytes < zip.length / 2, 'stop_times.txt is never downloaded');
  assert.ok(log.every(entry => entry.status === 206));
  // A wrong CRC in the directory with intact compressed data: only the CRC check can catch it.
  const wrongCrc = { ...directory, entries: new Map(directory.entries) };
  wrongCrc.entries.set('trips.txt', { ...directory.entries.get('trips.txt')!, crc32: '00000000' });
  await assert.rejects(readMembers(transport, 'zip', wrongCrc, ['trips.txt'], () => undefined), /CRC/);
});

test('remap: at most one attempt a day, conditional, never a full download, confirms an unchanged export', async () => {
  const site = server(archive('20261101'));
  let clock = Date.parse('2026-11-01T10:00:00Z'); const confirmations: number[] = [];
  let activeCrc: Record<string, string> | undefined;
  const store = await createSqlRemapStore(await createBunDriver(fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-remap-'))).open('gtt-remap.db'));
  try {
  const service = createRemapService({ store, transport: site.transport, url: 'zip', now: () => clock, activeSourceCrc: () => activeCrc, onUpstreamConfirmed: at => confirmations.push(at) });
  const first = await service.refresh('unknown-trips');
  assert.equal(first.outcome, 'updated'); assert.equal(first.requests, 3, 'tail + two grouped member ranges');
  assert.deepEqual(await store.lookup(['20261101-7', 'missing']), new Map([['20261101-7', { routeId: '4U', direction: 1, shapeId: '4A1', serviceId: 'SVC1' }]]));
  assert.deepEqual([...await store.activeServices('20261102')].sort(), ['SVC1'], 'calendar_dates applied');
  assert.equal((await store.meta())?.feedVersion, '20261101');
  clock += 3_600_000;
  assert.equal((await service.refresh('unknown-trips')).outcome, 'throttled', 'one attempt per day');
  clock += REMAP_POLICY.minIntervalMs;
  const unchanged = await service.refresh('unknown-trips');
  assert.equal(unchanged.outcome, 'not-modified'); assert.equal(unchanged.requests, 1);
  assert.equal(site.log.at(-1)?.headers['If-None-Match'], '"v1"');
  // GTT republishes the same members: the CRCs match the active package, so nothing is downloaded.
  const same = archive('20261101'); site.replace(same, '"v2"');
  const directory = await readCentralDirectory(site.transport, 'zip');
  if (directory === 'not-modified') throw new Error('unexpected');
  activeCrc = Object.fromEntries([...directory.entries.values()].map(entry => [entry.name, entry.crc32]));
  clock += REMAP_POLICY.minIntervalMs;
  const current = await service.refresh('unknown-trips');
  assert.equal(current.outcome, 'package-current'); assert.deepEqual(confirmations, [clock]);
  // The archive changes between the directory and member reads: If-Range would send 200, which is refused.
  activeCrc = undefined;
  site.replace(archive('20261102'), '"v3"');
  const changing: typeof site.transport = async (url, headers, accept, maxBytes) => {
    const response = await site.transport(url, headers, accept, maxBytes);
    if (headers.Range?.startsWith('bytes=-')) site.replace(archive('20261103'), '"v4"');
    return response;
  };
  const racing = createRemapService({ store, transport: changing, url: 'zip', now: () => clock + REMAP_POLICY.minIntervalMs });
  assert.equal((await racing.refresh('manual')).outcome, 'failed');
  const refused = site.log.filter(entry => entry.status === 200);
  assert.ok(refused.length >= 1 && refused.every(entry => entry.headers['If-Range'] && entry.bytes === 0), 'If-Range answered 200 and was refused without a body');
  assert.equal((await store.meta())?.feedVersion, '20261101', 'the previous remap stays intact');
  } finally { await store.close?.(); }
});

test('remap respects the network preference and a missing transport', async () => {
  const offline = createRemapService({ store: createMemoryRemapStore(), transport: server(archive('x')).transport, url: 'zip', networkAllowed: async () => false });
  assert.equal((await offline.refresh('manual')).outcome, 'skipped-network');
  assert.equal((await createRemapService({ store: createMemoryRemapStore(), url: 'zip' }).refresh('manual')).outcome, 'unsupported');
});

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
function eocdOffset(zip: Uint8Array) { for (let at = zip.length - 22; at >= 0; at--) if (view(zip).getUint32(at, true) === 0x06054b50) return at; throw new Error('no eocd'); }
/** Rewrite the declared uncompressed size of one member in the central directory. */
function declareSize(zip: Uint8Array, name: string, size: number) {
  const out = zip.slice(); const eocd = eocdOffset(out); let at = view(out).getUint32(eocd + 16, true);
  for (let index = 0; index < view(out).getUint16(eocd + 10, true); index++) {
    const length = view(out).getUint16(at + 28, true);
    if (new TextDecoder().decode(out.subarray(at + 46, at + 46 + length)) === name) view(out).setUint32(at + 24, size, true);
    at += 46 + length + view(out).getUint16(at + 30, true) + view(out).getUint16(at + 32, true);
  }
  return out;
}

test('inflation is bounded: a member that inflates beyond its declared size aborts early', async () => {
  // 16 MB of zeros compresses to ~16 KB; the directory claims 16,500 bytes.
  const bomb = declareSize(zipSync({ 'trips.txt': new Uint8Array(16 * 1024 * 1024), 'feed_info.txt': strToU8('a\n') }, { level: 9 }), 'trips.txt', 16_500);
  const { transport } = server(bomb);
  const directory = await readCentralDirectory(transport, 'zip');
  if (directory === 'not-modified') throw new Error('unexpected');
  let received = 0; let largestChunk = 0;
  await assert.rejects(readMembers(transport, 'zip', directory, ['trips.txt'], (_, chunk) => { received += chunk.length; largestChunk = Math.max(largestChunk, chunk.length); }),
    (error: unknown) => error instanceof ZipRangeError && error.kind === 'limit');
  assert.ok(received <= 16_500, `only the declared bytes reach the parser (${received})`);
  assert.ok(largestChunk <= 1100 * 1024, 'no single step produces more than ~1 MB');
  // Declared sizes beyond the limits are refused before any member is requested.
  const huge = declareSize(archive('20261101'), 'trips.txt', 20 * 1024 * 1024);
  const hugeServer = server(huge);
  const hugeDirectory = await readCentralDirectory(hugeServer.transport, 'zip');
  if (hugeDirectory === 'not-modified') throw new Error('unexpected');
  await assert.rejects(readMembers(hugeServer.transport, 'zip', hugeDirectory, ['trips.txt'], () => undefined), (error: unknown) => error instanceof ZipRangeError && error.kind === 'limit');
  assert.equal(hugeServer.log.length, 1, 'only the tail was fetched');
  // CSV record and line limits.
  assert.throws(() => csvRows(() => undefined, { maxRows: 2, maxLineLength: 100 })('h\n1\n2\n3\n', true), (error: unknown) => error instanceof ZipRangeError && error.kind === 'limit');
  assert.throws(() => csvRows(() => undefined, { maxRows: 10, maxLineLength: 8 })('h\n123456789012\n', false), ZipRangeError);
});

test('a hostile end-of-directory or mismatched Content-Range is refused without large reads', async () => {
  for (const [size, offset] of [[0xffffffff, 0], [0x7ffffff0, 0], [100, 0xfffffff0]] as const) {
    const zip = archive('20261101'); const eocd = eocdOffset(zip);
    view(zip).setUint32(eocd + 12, size, true); if (offset) view(zip).setUint32(eocd + 16, offset, true);
    const site = server(zip);
    await assert.rejects(readCentralDirectory(site.transport, 'zip'), ZipRangeError, `size ${size}`);
    assert.equal(site.log.length, 1, 'no directory request beyond the tail');
  }
  const zip = archive('20261101'); const site = server(zip);
  const lying: RangeTransport = async (url, headers, accept, maxBytes) => {
    const response = await site.transport(url, headers, accept, maxBytes);
    return { ...response, header: (name: string) => name.toLowerCase() === 'content-range' ? `bytes 0-${response.body.length - 1}/${zip.length}` : response.header(name) };
  };
  const directory = await readCentralDirectory(site.transport, 'zip');
  if (directory === 'not-modified') throw new Error('unexpected');
  await assert.rejects(readMembers(lying, 'zip', directory, ['trips.txt'], () => undefined), (error: unknown) => error instanceof ZipRangeError && error.kind === 'unsupported');
  const short: RangeTransport = async (url, headers, accept, maxBytes) => ({ ...(await site.transport(url, headers, accept, maxBytes)), body: new Uint8Array(10) });
  await assert.rejects(readMembers(short, 'zip', directory, ['trips.txt'], () => undefined), ZipRangeError, 'body length must match Content-Range');
});

test('a damaged remap database is discarded and recreated; storage failures never escape refresh', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-remap-'));
  const driver = createBunDriver(directory);
  fs.writeFileSync(path.join(directory, 'gtt-remap.db'), 'not a database'.repeat(200));
  const store = lazyRemapStore(async () => createSqlRemapStore(await driver.open('gtt-remap.db')), () => driver.remove('gtt-remap.db'));
  assert.equal(await store.meta(), undefined, 'recreated empty');
  const service = createRemapService({ store, transport: server(archive('20261101')).transport, url: 'zip' });
  assert.equal((await service.refresh('manual')).outcome, 'updated');
  assert.equal((await store.meta())?.feedVersion, '20261101');
  let resets = 0;
  const failing = { ...createMemoryRemapStore(), readState: async () => { throw new Error('SQLITE_IOERR'); }, reset: async () => { resets++; } };
  const report = await createRemapService({ store: failing, transport: server(archive('x')).transport, url: 'zip' }).refresh('manual');
  assert.equal(report.outcome, 'failed'); assert.equal(resets, 1);
  const writeFails = { ...createMemoryRemapStore(), replace: async () => { throw new Error('SQLITE_FULL'); }, reset: async () => { resets++; } };
  assert.equal((await createRemapService({ store: writeFails, transport: server(archive('y')).transport, url: 'zip' }).refresh('manual')).outcome, 'failed');
  assert.equal(resets, 2, 'a storage failure while saving discards the partial remap');
  await store.reset();
});

test('malformed or ambiguous remap rows reject the whole remap; CSV quoting must close', async () => {
  const cases: [string, (trips: string) => Record<string, Uint8Array>][] = [
    ['duplicate trip_id', trips => ({ 'trips.txt': strToU8(trips + '4U,SVC0,20261101-0,X,0,b,4A0\n') })],
    ['direction_id', trips => ({ 'trips.txt': strToU8(trips.replace(',0,b0,', ',north,b0,')) })],
    ['calendar.txt', () => ({ 'calendar.txt': strToU8('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC0,1,1,1,1,1,0,0,20261231,20261001\n') })],
    ['calendar_dates.txt', () => ({ 'calendar_dates.txt': strToU8('service_id,date,exception_type\nSVC1,2026-11-02,1\n') })],
  ];
  for (const [label, override] of cases) {
    let trips = TRIPS_HEADER;
    for (let index = 0; index < 1500; index++) trips += `4U,SVC${index % 3},20261101-${index},X,${index % 2},b${index},4A${index % 2}\n`;
    const base = { 'calendar.txt': strToU8('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC0,1,1,1,1,1,0,0,20261001,20261231\n'),
      'calendar_dates.txt': strToU8('service_id,date,exception_type\n'), 'trips.txt': strToU8(trips), 'feed_info.txt': strToU8('feed_version\n1\n') };
    const store = createMemoryRemapStore();
    const report = await createRemapService({ store, transport: server(zipSync({ ...base, ...override(trips) })).transport, url: 'zip' }).refresh('manual');
    assert.equal(report.outcome, 'failed', label);
    assert.equal(await store.meta(), undefined, `${label}: nothing stored`);
  }
  assert.throws(() => csvRows(() => undefined)('a\n"open', true), /virgolette/);
  // An empty deflated member is malformed.
  const empty = zipSync({ 'trips.txt': new Uint8Array(0) }, { level: 6 });
  const directory = await readCentralDirectory(server(empty).transport, 'zip');
  if (directory === 'not-modified') throw new Error('unexpected');
  const entry = directory.entries.get('trips.txt')!;
  const forged = { ...directory, entries: new Map([['trips.txt', { ...entry, method: 8, compressedSize: 0 }]]) };
  await assert.rejects(readMembers(server(empty).transport, 'zip', forged, ['trips.txt'], () => undefined), /vuoti/);
});
