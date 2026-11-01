import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createRemapService, createSqlRemapStore, createMemoryRemapStore, REMAP_POLICY } from './remap';
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
  const transport: RangeTransport = async (_url, headers, accept) => {
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
    // Like the XHR transport: an unexpected status is rejected at the headers, without the body.
    log.push({ headers, status, bytes: accept.includes(status) && status !== 304 ? slice.length : 0 });
    if (!accept.includes(status)) throw new ZipRangeError(`HTTP ${status}`, status === 200 ? 'changed' : 'unsupported');
    return { status, body: status === 304 ? new Uint8Array() : slice, header: (name: string) => ({ etag, 'last-modified': 'Sun, 01 Nov 2026 02:26:59 GMT', 'content-range': `bytes ${start}-${start + slice.length - 1}/${body.length}` } as Record<string, string>)[name.toLowerCase()] };
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
  // Corrupt one byte inside trips.txt: the CRC check rejects it.
  const corrupt = zip.slice(); const entry = directory.entries.get('trips.txt')!; corrupt[entry.offset + 100] = corrupt[entry.offset + 100]! ^ 0xff;
  await assert.rejects(readMembers(server(corrupt).transport, 'zip', directory, ['trips.txt'], () => undefined), ZipRangeError);
});

test('remap: at most one attempt a day, conditional, never a full download, confirms an unchanged export', async () => {
  const site = server(archive('20261101'));
  let clock = Date.parse('2026-11-01T10:00:00Z'); const confirmations: number[] = [];
  let activeCrc: Record<string, string> | undefined;
  const store = await createSqlRemapStore(await createBunDriver(fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-remap-'))).open('gtt-remap.db'));
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
  const changing: typeof site.transport = async (url, headers, accept) => {
    const response = await site.transport(url, headers, accept);
    if (headers.Range?.startsWith('bytes=-')) site.replace(archive('20261103'), '"v4"');
    return response;
  };
  const racing = createRemapService({ store, transport: changing, url: 'zip', now: () => clock + REMAP_POLICY.minIntervalMs });
  assert.equal((await racing.refresh('manual')).outcome, 'failed');
  assert.ok(site.log.filter(entry => entry.status === 200).every(entry => entry.bytes === 0), 'no full-body download');
  assert.equal((await store.meta())?.feedVersion, '20261101', 'the previous remap stays intact');
});

test('remap respects the network preference and a missing transport', async () => {
  const offline = createRemapService({ store: createMemoryRemapStore(), transport: server(archive('x')).transport, url: 'zip', networkAllowed: async () => false });
  assert.equal((await offline.refresh('manual')).outcome, 'skipped-network');
  assert.equal((await createRemapService({ store: createMemoryRemapStore(), url: 'zip' }).refresh('manual')).outcome, 'unsupported');
});
