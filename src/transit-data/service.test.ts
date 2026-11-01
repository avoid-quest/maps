import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeBoard } from './board';
import type { PackageManifest } from './package-format';
import { createPackageStore } from './package-store';
import { indexFeed } from './realtime';
import { bindActive, confirmedAt, failedCheck, INITIAL_REFRESH_STATE, REFRESH_POLICY, restoreRefreshState, scheduleNotices, shouldCheck, startedCheck, succeededCheck, withEvidence } from './refresh-policy';
import { createStaticTimetableService, createTimetableService } from './service';
import { encodePackage, fixtureManifest, fixturePackage, fixtureReader, rome } from './test-support/fixture';
import { createTestFiles, sha256 } from './test-support/files';
import { createBunDriver } from './test-support/sqlite-driver';

const HOUR = 3_600_000;

test('refresh policy: 6 h on open, 1/h on mismatch, backoff on failure, manual bypasses backoff', () => {
  const t = 1_800_000_000_000;
  let state = succeededCheck(INITIAL_REFRESH_STATE, t);
  assert.equal(shouldCheck(state, 'open', t + 5 * HOUR), false);
  assert.equal(shouldCheck(state, 'open', t + 6 * HOUR), true);
  assert.equal(shouldCheck(state, 'mismatch', t + 60_000), true, 'mismatch ignores the 6 h interval');
  state = startedCheck(state, 'mismatch', t + 60_000);
  assert.equal(shouldCheck(state, 'mismatch', t + 30 * 60_000), false, 'once per hour');
  assert.equal(shouldCheck(state, 'mismatch', t + 60_000 + HOUR), true);
  let failing = failedCheck(state, t); assert.equal(failing.nextAllowedAt, t + REFRESH_POLICY.backoffBaseMs);
  failing = failedCheck(failing, t); assert.equal(failing.nextAllowedAt, t + 2 * REFRESH_POLICY.backoffBaseMs);
  for (let index = 0; index < 20; index++) failing = failedCheck(failing, t);
  assert.equal(failing.nextAllowedAt, t + REFRESH_POLICY.backoffMaxMs);
  assert.equal(shouldCheck({ ...failing, lastMismatchCheckAt: undefined }, 'mismatch', t + HOUR), false, 'mismatch respects failure backoff');
  assert.equal(shouldCheck({ ...failing, lastCheckAt: t }, 'manual', t + 11_000), true, 'manual bypasses backoff');
  assert.equal(shouldCheck({ ...failing, lastCheckAt: t }, 'manual', t + 5_000), false);
});

test('schedule notices: 48 h without upstream confirmation, unknown confirmation, expiry and coverage', () => {
  const reader = fixtureReader();
  const checked = Date.parse(reader.meta.manifest.upstream_checked_at!);
  assert.deepEqual(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, checked + 47 * HOUR), []);
  assert.deepEqual(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, checked + 49 * HOUR).map(notice => notice.code), ['schedule-unconfirmed']);
  const later = withEvidence(bindActive(INITIAL_REFRESH_STATE, reader.meta.packageHash), { confirmedAt: checked + 40 * HOUR });
  assert.deepEqual(scheduleNotices(reader.meta, later, checked + 49 * HOUR), [], 'later confirmation of this package counts');
  const other = withEvidence(bindActive(INITIAL_REFRESH_STATE, 'f'.repeat(64)), { confirmedAt: checked + 40 * HOUR });
  assert.deepEqual(scheduleNotices(reader.meta, bindActive(other, reader.meta.packageHash), checked + 49 * HOUR).map(notice => notice.code), ['schedule-unconfirmed'], 'another package\'s confirmation never counts');
  const unknown = { ...reader.meta, manifest: { ...reader.meta.manifest, upstream_checked_at: null } };
  assert.match(scheduleNotices(unknown, INITIAL_REFRESH_STATE, checked).find(notice => notice.code === 'schedule-unconfirmed')!.text, /sconosciuta/, 'a local build has no confirmation');
  const recent = withEvidence(bindActive(INITIAL_REFRESH_STATE, reader.meta.packageHash), { confirmedAt: rome('20261126', '06:00') });
  assert.deepEqual(scheduleNotices(reader.meta, recent, rome('20261126', '08:00')).map(notice => notice.code), ['schedule-expiring']);
  assert.ok(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, rome('20261201', '08:00')).some(notice => notice.code === 'schedule-outside-coverage'));
  assert.ok(!scheduleNotices(reader.meta, recent, rome('20261201', '01:00')).some(notice => notice.code === 'schedule-outside-coverage'), 'overnight trips of the final day are covered');
});

test('refresh evidence is keyed by package and survives persistence', () => {
  const a = 'a'.repeat(64); const b = 'b'.repeat(64);
  let state = withEvidence(bindActive(INITIAL_REFRESH_STATE, a), { confirmedAt: 1000, validator: { mirror: 'm/', etag: '"A"' } });
  state = succeededCheck(state, 5000);
  state = withEvidence(bindActive(state, b), { confirmedAt: 9000, validator: { mirror: 'm/', etag: '"B"' } });
  assert.equal(state.lastSuccessAt, undefined, 'a switch restarts the 6 h interval');
  const back = bindActive(restoreRefreshState(JSON.parse(JSON.stringify(state))), a);
  assert.equal(confirmedAt(back), 1000); assert.deepEqual(back.evidence[a]?.validators, { 'm/': '"A"' });
  assert.deepEqual(restoreRefreshState({ evidence: { nothex: {} }, failures: 'x', wifiOnly: 1 }), INITIAL_REFRESH_STATE, 'untrusted storage is normalised');
});

const BASE = 'https://primary.test/gtt/';
const MIRROR = 'https://mirror.test/gtt/';
const RELEASES = 'https://releases.test/download/gtt-timetable/';
function setup(options: { wifi?: boolean | 'throws'; directory?: string; mirrors?: string[]; bundled?: { text: string; manifest: PackageManifest } } = {}) {
  const directory = options.directory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const bundledPkg = fixturePackage(); const bundledText = encodePackage(bundledPkg);
  const bundled = options.bundled ?? { text: bundledText, manifest: fixtureManifest(bundledText, bundledPkg) };
  const served = new Map<string, string>();
  const files = createTestFiles(path.join(directory, 'files'), served);
  const driver = createBunDriver(path.join(directory, 'db'));
  const store = createPackageStore({ driver, files, sha256, bundled: { manifest: bundled.manifest, load: async () => bundled.text }, closeLater: db => void db.close() });
  let clock = rome('20261021', '08:02');
  let manifest: PackageManifest | undefined = bundled.manifest; let etag = '"m1"'; const down = new Set<string>(); let networkLookups = 0;
  const requests: { url: string; headers: Record<string, string>; credentials?: RequestCredentials }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: { ...(init?.headers as Record<string, string> | undefined) }, credentials: init?.credentials });
    if ([...down].some(base => url.startsWith(base))) throw new TypeError('Network request failed');
    if ((init?.headers as Record<string, string> | undefined)?.['If-None-Match'] === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(manifest), { status: 200, headers: { ETag: etag } });
  }) as typeof globalThis.fetch;
  const mirrors = options.mirrors ?? [BASE];
  const service = createTimetableService({
    store, fetch, mirrors: mirrors.map(base => ({ base, layout: base === RELEASES ? 'flat' as const : 'tree' as const })), now: () => clock,
    networkAllowed: async wifiOnly => { networkLookups++; if (options.wifi === 'throws') throw new Error('state unavailable'); return !wifiOnly || options.wifi === true; },
  });
  const release = (feedVersion: string, builtAt: string, overrides: Partial<PackageManifest> = {}, variant = '') => {
    const pkg = fixturePackage({ feedVersion, tripPrefix: `N${feedVersion}${variant}-` }); const text = encodePackage(pkg);
    return { text, manifest: fixtureManifest(text, pkg, { built_at: builtAt, upstream_checked_at: builtAt, ...overrides }) };
  };
  const publish = (feedVersion: string, builtAt: string, overrides: Partial<PackageManifest> = {}, on: string[] = mirrors, variant = '') => {
    const next = release(feedVersion, builtAt, overrides, variant);
    manifest = next.manifest; etag = `"${feedVersion}-${builtAt}"`;
    for (const base of on) served.set(base + (base === RELEASES ? next.manifest.package_path.replace('packages/', '') : next.manifest.package_path), next.text);
    return next.manifest;
  };
  return {
    service, store, driver, directory, requests, files, publish, release, bundled: bundled.manifest,
    serve: (url: string, text: string) => { served.set(url, text); },
    advance: (ms: number) => { clock += ms; }, now: () => clock,
    setManifest: (value: PackageManifest, tag: string) => { manifest = value; etag = tag; },
    setDown: (base: string, value: boolean) => { if (value) down.add(base); else down.delete(base); },
    networkLookups: () => networkLookups,
  };
}

test('manifest checks are plain conditional GETs and confirm the active package', async () => {
  const env = setup();
  assert.equal(await env.service.check('open'), 'current');
  assert.deepEqual(env.requests, [{ url: `${BASE}manifest.json`, headers: {}, credentials: 'omit' }], 'no identifiers, query parameters, custom headers or cookies');
  assert.equal(confirmedAt(env.service.status().refresh), Date.parse(env.bundled.upstream_checked_at!));
  env.advance(HOUR);
  assert.equal(await env.service.check('open'), 'throttled');
  assert.equal(await env.service.check('manual'), 'not-modified');
  assert.deepEqual(env.requests[1], { url: `${BASE}manifest.json`, headers: { 'If-None-Match': '"m1"' }, credentials: 'omit' });
});

test('ordered mirrors: the next mirror is used only when one fails; validators stay per mirror', async () => {
  const env = setup({ mirrors: [BASE, MIRROR] });
  env.setDown(BASE, true);
  const published = env.publish('20261021', '2026-10-21T03:15:00Z', {}, [MIRROR]);
  assert.equal(await env.service.check('open'), 'installed');
  assert.deepEqual(env.requests.map(request => request.url), [`${BASE}manifest.json`, `${MIRROR}manifest.json`]);
  assert.deepEqual(env.files.requested, [MIRROR + published.package_path], 'package fetched from the serving mirror');
  env.setDown(BASE, false); env.advance(REFRESH_POLICY.manualMinIntervalMs);
  assert.equal(await env.service.check('manual'), 'current');
  assert.deepEqual(env.requests.at(-1), { url: `${BASE}manifest.json`, headers: {}, credentials: 'omit' }, 'the other mirror\'s ETag is not sent');
});

test('Releases mirror uses the flat asset layout', async () => {
  const env = setup({ mirrors: [BASE, RELEASES] });
  env.setDown(BASE, true);
  const published = env.publish('20261021', '2026-10-21T03:15:00Z', {}, [RELEASES]);
  assert.equal(await env.service.check('open'), 'installed');
  assert.deepEqual(env.files.requested, [`${RELEASES}gtt-${published.package_hash}.json`]);
});

test('rollback restores the other package\'s own evidence: no foreign ETag or confirmation', async () => {
  const env = setup();
  await env.service.check('open');
  env.advance(60_000);
  const b = env.publish('20261021', '2026-10-21T03:15:00Z');
  assert.equal(await env.service.check('manual'), 'installed');
  // Corrupt B's database and restart: the store rolls back to A.
  const active = (await env.store.packages()).find(entry => entry.role === 'active')!;
  fs.writeFileSync(env.driver.file(active.db), 'corrupt'.repeat(500));
  const restarted = setup({ directory: env.directory });
  restarted.setManifest(b, `"20261021-2026-10-21T03:15:00Z"`);
  const dataset = await restarted.service.ready();
  assert.equal(dataset.meta.packageHash, env.bundled.package_hash);
  assert.equal(confirmedAt(restarted.service.status().refresh), Date.parse(env.bundled.upstream_checked_at!), 'A keeps its own confirmation, not B\'s');
  assert.equal(restarted.service.status().refresh.lastSuccessAt, undefined, 'the 6 h interval restarts after a rollback');
  restarted.publish('20261021', '2026-10-21T03:15:00Z');
  assert.equal(await restarted.service.check('manual'), 'installed', 'B\'s ETag is not sent, so B is downloaded again');
  assert.deepEqual(restarted.requests[0]!.headers, { 'If-None-Match': '"m1"' }, 'only A\'s own validator');
});

test('stale-package mismatch: zero joins trigger one check that installs the new package, then rows join', async () => {
  const env = setup();
  await env.service.check('open');
  env.advance(60_000);
  const published = env.publish('20261021', '2026-10-21T03:15:00Z');
  const now = env.now();
  const feed = { header: { gtfsRealtimeVersion: '2.0', timestamp: now / 1000 }, entity: [{ id: '1', tripUpdate: { timestamp: (now - 20_000) / 1000, trip: { tripId: 'N20261021-T1', startDate: '20261021', startTime: '08:00:00' }, stopTimeUpdate: [{ stopSequence: 1, arrival: { delay: 240 } }] } }] };
  const snapshot = indexFeed(feed, now);
  const before = (await env.service.current()).reader;
  const stale = await composeBoard(before, 'A', now, { refresh: env.service.status().refresh, realtime: { snapshot } });
  assert.equal(stale.realtime.state, 'unmatched');
  assert.ok(stale.rows.length > 0, 'scheduled rows remain');
  assert.equal(await env.service.check('mismatch'), 'installed');
  assert.equal(env.service.status().meta?.packageHash, published.package_hash);
  const after = (await env.service.current()).reader;
  const board = await composeBoard(after, 'A', now, { refresh: env.service.status().refresh, realtime: { snapshot } });
  assert.equal(board.realtime.state, 'ok');
  assert.equal(board.rows.find(row => row.gtt.tripId === 'N20261021-T1')?.realtimeState, 'realtime-with-source-time');
  env.advance(10 * 60_000);
  assert.equal(await env.service.check('mismatch'), 'throttled', 'one mismatch check per hour');
});

test('older GTT sources never replace newer ones, whatever their build time', async () => {
  const env = setup();
  const newer = env.publish('20261021', '2026-10-21T03:15:00Z');
  assert.equal(await env.service.check('open'), 'installed');
  env.advance(REFRESH_POLICY.manualMinIntervalMs);
  env.publish('20261019', '2026-10-25T03:15:00Z');
  assert.equal(await env.service.check('manual'), 'outdated-manifest', 'rebuilt older ZIP rejected');
  env.advance(REFRESH_POLICY.manualMinIntervalMs);
  env.publish('20261021', '2026-10-26T03:15:00Z', { source_last_modified: '2026-10-18T02:26:59Z', source_zip_hash: 'c'.repeat(64) }, undefined, 'b');
  assert.equal(await env.service.check('manual'), 'outdated-manifest', 'same feed version, older upstream modification');
  env.advance(REFRESH_POLICY.manualMinIntervalMs);
  const rebuilt = env.publish('20261021', '2026-10-27T03:15:00Z', { source_zip_hash: newer.source_zip_hash }, undefined, 'r');
  assert.equal(await env.service.check('manual'), 'installed', 'same source rebuilt later (builder change) is accepted');
  assert.equal(env.service.status().meta?.packageHash, rebuilt.package_hash);
  // An APK carrying an older source, built later, does not replace the download either.
  const older = env.release('20261019', '2026-10-30T03:15:00Z');
  const upgraded = setup({ directory: env.directory, bundled: older });
  assert.equal((await upgraded.service.ready()).meta.packageHash, rebuilt.package_hash);
});

test('failures back off; corrupt transfers try again; invalid packages are not refetched', async () => {
  const env = setup();
  const newer = env.publish('20261021', '2026-10-21T03:15:00Z');
  assert.equal(await env.service.check('open'), 'installed');
  env.advance(7 * HOUR); env.setDown(BASE, true);
  assert.equal(await env.service.check('open'), 'failed');
  assert.equal(env.service.status().refresh.failures, 1);
  env.advance(60_000);
  assert.equal(await env.service.check('open'), 'throttled', 'backoff');
  env.setDown(BASE, false);
  const bad = env.publish('20261022', '2026-10-22T03:15:00Z');
  env.setManifest({ ...bad, package_bytes: bad.package_bytes + 1 }, '"bad"');
  env.advance(REFRESH_POLICY.backoffBaseMs);
  assert.equal(await env.service.check('open'), 'failed', 'hash mismatch is a bad transfer, retried later');
  const invalid = env.release('20261023', '2026-10-23T03:15:00Z');
  const broken = invalid.text.replace('"schema_version":2', '"schema_version":3');
  const brokenManifest = { ...invalid.manifest, package_hash: await sha256(broken), package_path: `packages/gtt-${await sha256(broken)}.json` };
  env.setManifest(brokenManifest, '"invalid"');
  env.serve(BASE + brokenManifest.package_path, broken);
  env.advance(REFRESH_POLICY.backoffMaxMs);
  assert.equal(await env.service.check('open'), 'rejected', 'verified bytes, invalid content');
  const downloads = env.files.requested.length;
  env.advance(REFRESH_POLICY.backoffMaxMs);
  // The same manifest served again under a new ETag (a full 200): still not downloaded.
  env.setManifest(brokenManifest, '"invalid-again"');
  assert.equal(await env.service.check('manual'), 'rejected');
  assert.equal(env.files.requested.length, downloads, 'the rejected package is not downloaded again');
  assert.equal(env.service.status().meta?.packageHash, newer.package_hash);
});

test('Wi-Fi-only preference defers checks, also when the network type is unknown', async () => {
  const env = setup({ wifi: false });
  await env.service.setWifiOnly(true);
  assert.equal(await env.service.check('manual'), 'skipped-network');
  assert.equal(env.requests.length, 0);
  assert.equal(env.service.status().refresh.failures, 0);
  assert.equal((await env.store.readState()).wifiOnly, true, 'preference persists');
  const unknown = setup({ wifi: 'throws' });
  await unknown.service.setWifiOnly(true);
  assert.equal(await unknown.service.check('manual'), 'skipped-network', 'fails closed');
  assert.equal(unknown.requests.length, 0);
  await unknown.service.setWifiOnly(false);
  unknown.advance(REFRESH_POLICY.manualMinIntervalMs);
  assert.equal(await unknown.service.check('manual'), 'current', 'any-connection mode does not depend on the lookup');
});

test('a check completing after a preference change never restores the old preference', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const pkg = fixturePackage(); const text = encodePackage(pkg); const manifest = fixtureManifest(text, pkg);
  const store = createPackageStore({ driver: createBunDriver(path.join(directory, 'db')), files: createTestFiles(path.join(directory, 'files'), new Map()), sha256, bundled: { manifest, load: async () => text }, closeLater: db => void db.close() });
  let release!: (response: Response) => void;
  const fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as unknown as typeof globalThis.fetch;
  const service = createTimetableService({ store, fetch, mirrors: [{ base: BASE, layout: 'tree' }], now: () => rome('20261021', '08:00') });
  await service.setStopLive(true);
  const pending = service.check('manual');
  await new Promise(resolve => setTimeout(resolve, 0));
  await service.setStopLive(false);
  release(new Response(JSON.stringify(manifest), { status: 200, headers: { ETag: '"x"' } }));
  assert.equal(await pending, 'current');
  assert.equal(service.status().refresh.stopLive, false, 'in memory');
  assert.equal((await store.readState()).stopLive, false, 'persisted');
});

test('a preference changed while the network type is looked up is not reverted', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const pkg = fixturePackage(); const text = encodePackage(pkg); const manifest = fixtureManifest(text, pkg);
  const store = createPackageStore({ driver: createBunDriver(path.join(directory, 'db')), files: createTestFiles(path.join(directory, 'files'), new Map()), sha256, bundled: { manifest, load: async () => text }, closeLater: db => void db.close() });
  let allow!: (value: boolean) => void;
  const fetch = (async () => new Response(JSON.stringify(manifest), { status: 200 })) as unknown as typeof globalThis.fetch;
  const service = createTimetableService({ store, fetch, mirrors: [{ base: BASE, layout: 'tree' }], now: () => rome('20261021', '08:00'),
    networkAllowed: () => new Promise<boolean>(resolve => { allow = resolve; }) });
  await service.ready();
  const pending = service.check('manual');
  await new Promise(resolve => setTimeout(resolve, 0));
  await service.setStopLive(true);
  allow(true);
  await pending;
  assert.equal(service.status().refresh.stopLive, true);
});

test('a preference set while the dataset cannot open never overwrites the stored state', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const pkg = fixturePackage(); const text = encodePackage(pkg); const manifest = fixtureManifest(text, pkg);
  const store = createPackageStore({ driver: createBunDriver(path.join(directory, 'db')), files: createTestFiles(path.join(directory, 'files'), new Map()), sha256, bundled: { manifest, load: async () => text }, closeLater: db => void db.close() });
  await store.open();
  await store.writeState({ ...INITIAL_REFRESH_STATE, wifiOnly: true, stopLive: true });
  let writes = 0;
  const broken = { ...store, open: async () => { throw new Error('SQLITE_BUSY'); }, writeState: async () => { writes++; } } as typeof store;
  const service = createTimetableService({ store: broken, fetch: globalThis.fetch, mirrors: [] });
  await service.setWifiOnly(false);
  assert.equal(writes, 0, 'defaults are not persisted over the stored state');
  assert.equal(service.status().refresh.wifiOnly, false, 'the choice applies for this session');
  assert.match(service.status().lastError ?? '', /Impossibile salvare/);
  assert.equal(await service.check('manual'), 'failed');
  assert.equal(service.status().lastOutcome, 'failed', 'status agrees with the check outcome');
  assert.equal((await store.readState()).stopLive, true);
});

test('service robustness: throttled outcome, clock skew, stalled body, malformed state, persistence errors', async () => {
  // Throttled checks report their outcome.
  const env = setup();
  await env.service.check('open');
  assert.equal(await env.service.check('open'), 'throttled');
  assert.equal(env.service.status().lastOutcome, 'throttled');
  // A backoff deadline further ahead than the maximum (clock moved back) no longer blocks.
  const skewed = { ...failedCheck(INITIAL_REFRESH_STATE, 1_000_000_000_000), lastSuccessAt: undefined };
  assert.equal(shouldCheck(skewed, 'open', 1_000_000_000_000 - 10 * HOUR), true);
  // Malformed persisted state is normalised by the store.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const pkg = fixturePackage(); const text = encodePackage(pkg); const manifest = fixtureManifest(text, pkg);
  const store = createPackageStore({ driver: createBunDriver(path.join(directory, 'db')), files: createTestFiles(path.join(directory, 'files'), new Map()), sha256, bundled: { manifest, load: async () => text }, closeLater: db => void db.close() });
  await store.open();
  await store.writeState({ evidence: 'broken', failures: 'x' } as unknown as Parameters<typeof store.writeState>[0]);
  assert.deepEqual((await store.readState()).evidence, {});
  // A mirror that stalls mid-body cannot block later checks: the deadline covers the body.
  let calls = 0;
  const stalled = (async () => { calls++; return new Response(new ReadableStream({ start() { /* never sends */ } })); }) as unknown as typeof globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => originalSetTimeout(callback, ms === 20_000 ? 5 : ms)) as typeof setTimeout;
  try {
    const service = createTimetableService({ store, fetch: stalled, mirrors: [{ base: BASE, layout: 'tree' }] });
    assert.equal(await service.check('manual'), 'failed');
    assert.equal(await service.check('manual'), 'throttled', 'the next check is no longer blocked by an in-flight read');
    assert.equal(calls, 1);
  } finally { globalThis.setTimeout = originalSetTimeout; }
  // A preference that cannot be persisted is reported.
  const failing = { ...store, writeState: async () => { throw new Error('SQLITE_FULL'); } } as typeof store;
  const service = createTimetableService({ store: failing, fetch: stalled, mirrors: [] });
  await service.setStopLive(true);
  assert.match(service.status().lastError ?? '', /Impossibile salvare/);
});

test('the static (web/test) service reports a failed open and allows a retry', async () => {
  let attempts = 0;
  const service = createStaticTimetableService(async () => { attempts++; throw new Error('asset missing'); });
  await assert.rejects(service.ready(), /asset missing/);
  assert.equal(service.status().phase, 'failed');
  await assert.rejects(service.ready());
  assert.equal(attempts, 2);
});

test('a different source that cannot be ordered is never an upgrade; a same-source rebuild is', async () => {
  const { isUpgrade } = await import('./package-format');
  const pkg = fixturePackage(); const base = fixtureManifest(encodePackage(pkg), pkg, { source_last_modified: null });
  const otherZip = { ...base, source_zip_hash: 'c'.repeat(64), built_at: '2026-12-01T00:00:00Z' };
  assert.equal(isUpgrade(otherZip, base), false, 'same feed_version, unknown modification times, different ZIP');
  assert.equal(isUpgrade({ ...base, built_at: '2026-12-01T00:00:00Z' }, base), true, 'same ZIP rebuilt later');
});
