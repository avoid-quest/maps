import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeBoard } from './board';
import type { PackageManifest } from './package-format';
import { createPackageStore } from './package-store';
import { indexFeed } from './realtime';
import { failedCheck, INITIAL_REFRESH_STATE, REFRESH_POLICY, scheduleNotices, shouldCheck, startedCheck, succeededCheck } from './refresh-policy';
import { createTimetableService } from './service';
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

test('schedule notices: 48 h without upstream confirmation, expiry and coverage', () => {
  const reader = fixtureReader();
  const checked = Date.parse(reader.meta.manifest.upstream_checked_at);
  assert.deepEqual(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, checked + 47 * HOUR), []);
  assert.deepEqual(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, checked + 49 * HOUR).map(notice => notice.code), ['schedule-unconfirmed']);
  assert.deepEqual(scheduleNotices(reader.meta, { ...INITIAL_REFRESH_STATE, confirmedAt: checked + 40 * HOUR }, checked + 49 * HOUR), [], 'later confirmation counts');
  assert.deepEqual(scheduleNotices(reader.meta, { ...INITIAL_REFRESH_STATE, confirmedAt: rome('20261126', '06:00') }, rome('20261126', '08:00')).map(notice => notice.code), ['schedule-expiring']);
  assert.ok(scheduleNotices(reader.meta, INITIAL_REFRESH_STATE, rome('20261201', '08:00')).some(notice => notice.code === 'schedule-outside-coverage'));
});

const MANIFEST_URL = 'https://example.test/gtt/manifest.json';
function setup(options: { wifi?: boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-service-'));
  const bundledPkg = fixturePackage(); const bundledText = encodePackage(bundledPkg);
  const bundledManifest = fixtureManifest(bundledText, bundledPkg);
  const served = new Map<string, string>();
  const files = createTestFiles(path.join(directory, 'files'), served);
  const store = createPackageStore({ driver: createBunDriver(path.join(directory, 'db')), files, sha256, bundled: { manifest: bundledManifest, load: () => JSON.parse(bundledText) }, closeLater: db => void db.close() });
  let clock = rome('20261021', '08:02');
  let manifest: PackageManifest | undefined = bundledManifest; let etag = '"m1"'; let failing = false;
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: { ...(init?.headers as Record<string, string> | undefined) } });
    if (failing) throw new TypeError('Network request failed');
    if ((init?.headers as Record<string, string> | undefined)?.['If-None-Match'] === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(manifest), { status: 200, headers: { ETag: etag } });
  }) as typeof globalThis.fetch;
  const service = createTimetableService({ store, fetch, manifestUrl: MANIFEST_URL, now: () => clock, networkAllowed: async wifiOnly => !wifiOnly || options.wifi === true });
  const publish = (feedVersion: string, builtAt: string) => {
    const pkg = fixturePackage({ feedVersion, tripPrefix: `N${feedVersion}-` }); const text = encodePackage(pkg);
    manifest = fixtureManifest(text, pkg, { built_at: builtAt, upstream_checked_at: builtAt }); etag = `"${feedVersion}"`;
    served.set(new URL(manifest.package_path, MANIFEST_URL).toString(), text);
    return manifest;
  };
  return {
    service, store, requests, files, publish, bundledManifest,
    advance: (ms: number) => { clock += ms; }, now: () => clock,
    setManifest: (value: PackageManifest, tag: string) => { manifest = value; etag = tag; },
    fail: (value: boolean) => { failing = value; },
  };
}

test('manifest checks are plain conditional GETs and confirm the active package', async () => {
  const env = setup();
  assert.equal(await env.service.check('open'), 'current');
  assert.deepEqual(env.requests, [{ url: MANIFEST_URL, headers: {} }], 'no identifiers, query parameters or custom headers');
  assert.equal(env.service.status().refresh.confirmedAt, Date.parse(env.bundledManifest.upstream_checked_at));
  env.advance(HOUR);
  assert.equal(await env.service.check('open'), 'throttled');
  assert.equal(await env.service.check('manual'), 'not-modified');
  assert.deepEqual(env.requests[1], { url: MANIFEST_URL, headers: { 'If-None-Match': '"m1"' } });
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
  const stale = await composeBoard(before, 'A', now, { refresh: env.service.status().refresh, realtime: { snapshot, matchedTrips: (await before.trips(['N20261021-T1'])).size } });
  assert.equal(stale.realtime.state, 'unmatched');
  assert.ok(stale.rows.length > 0, 'scheduled rows remain');
  assert.equal(await env.service.check('mismatch'), 'installed');
  assert.equal(env.service.status().meta?.packageHash, published.package_hash);
  const after = (await env.service.current()).reader;
  const board = await composeBoard(after, 'A', now, { refresh: env.service.status().refresh, realtime: { snapshot, matchedTrips: (await after.trips(['N20261021-T1'])).size } });
  assert.equal(board.realtime.state, 'ok');
  assert.equal(board.rows.find(row => row.gtt.tripId === 'N20261021-T1')?.realtimeState, 'realtime-with-source-time');
  env.advance(10 * 60_000);
  assert.equal(await env.service.check('mismatch'), 'throttled', 'one mismatch check per hour');
});

test('older manifests never downgrade; failures back off; rejected packages are not refetched', async () => {
  const env = setup();
  const newer = env.publish('20261021', '2026-10-21T03:15:00Z');
  assert.equal(await env.service.check('open'), 'installed');
  env.setManifest(env.bundledManifest, '"old"'); env.advance(REFRESH_POLICY.manualMinIntervalMs);
  assert.equal(await env.service.check('manual'), 'outdated-manifest');
  assert.equal(env.service.status().meta?.packageHash, newer.package_hash);
  env.advance(7 * HOUR); env.fail(true);
  assert.equal(await env.service.check('open'), 'failed');
  assert.equal(env.service.status().refresh.failures, 1);
  env.advance(60_000);
  assert.equal(await env.service.check('open'), 'throttled', 'backoff');
  env.fail(false);
  const bad = env.publish('20261022', '2026-10-22T03:15:00Z');
  env.setManifest({ ...bad, package_bytes: bad.package_bytes + 1 }, '"bad"');
  env.advance(REFRESH_POLICY.backoffBaseMs);
  assert.equal(await env.service.check('open'), 'rejected');
  const downloads = env.files.requested.length;
  env.advance(HOUR);
  assert.equal(await env.service.check('manual'), 'not-modified', 'conditional request: unchanged bad manifest');
  assert.equal(env.files.requested.length, downloads, 'the rejected package is not downloaded again');
  assert.equal(env.service.status().meta?.packageHash, newer.package_hash);
});

test('Wi-Fi-only preference defers checks without counting a failure', async () => {
  const env = setup({ wifi: false });
  await env.service.setWifiOnly(true);
  assert.equal(await env.service.check('manual'), 'skipped-network');
  assert.equal(env.requests.length, 0);
  assert.equal(env.service.status().refresh.failures, 0);
  assert.equal((await env.store.readState()).wifiOnly, true, 'preference persists');
});
