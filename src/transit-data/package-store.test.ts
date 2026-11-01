import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PackageError, type PackageManifest, type TimetablePackage } from './package-format';
import { compareRepresentativeQueries, createPackageStore } from './package-store';
import { createMemoryReader, datasetMeta } from './reader';
import { scheduledEvents } from './scheduled-board';
import { encodePackage, fixtureManifest, fixturePackage, rome } from './test-support/fixture';
import { createTestFiles, sha256 } from './test-support/files';
import { createBunDriver } from './test-support/sqlite-driver';

const BASE = 'https://example.test/gtt/';
const bundledPkg = fixturePackage();
const bundledText = encodePackage(bundledPkg);
const bundledManifest = fixtureManifest(bundledText, bundledPkg);
function release(feedVersion: string, builtAt: string, mutate?: (pkg: TimetablePackage) => void) {
  const pkg = fixturePackage({ feedVersion, tripPrefix: `N${feedVersion}-` }); mutate?.(pkg);
  const text = encodePackage(pkg);
  return { pkg, text, manifest: fixtureManifest(text, pkg, { built_at: builtAt, upstream_checked_at: builtAt }) };
}

function harness(directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-')), options: { failRunAfter?: number; free?: number; bundled?: { manifest: PackageManifest; text: string } } = {}) {
  const served = new Map<string, string>();
  const driver = createBunDriver(path.join(directory, 'db'), { failRunAfter: options.failRunAfter, failOn: name => name !== 'gtt-registry.db' });
  const files = createTestFiles(path.join(directory, 'files'), served, { freeBytes: options.free });
  let clock = Date.parse('2026-10-21T06:00:00Z');
  const bundled = options.bundled ?? { manifest: bundledManifest, text: bundledText };
  const store = createPackageStore({ driver, files, sha256, bundled: { manifest: bundled.manifest, load: async () => bundled.text }, now: () => clock++, closeLater: db => void db.close() });
  const serve = (manifest: PackageManifest, text: string, base = BASE) => { served.set(base + manifest.package_path, text); return [base + manifest.package_path]; };
  const databases = () => fs.readdirSync(path.join(directory, 'db')).filter(name => /^gtt-[0-9a-f]{16}-\d+\.db$/.test(name)).sort();
  return { directory, driver, files, store, serve, databases };
}

const departuresAtA = async (store: ReturnType<typeof createPackageStore>) => {
  const dataset = store.active()!;
  const { events } = await scheduledEvents(dataset.reader, 'A', rome('20261021', '07:55'), { lookbackMs: 0, horizonMs: 20 * 60_000 });
  return events.map(event => event.trip.tripId).sort();
};

test('first launch imports the bundled package offline and answers indexed queries', async () => {
  const { store, databases } = harness();
  const dataset = await store.open();
  assert.equal(dataset.meta.packageHash, bundledManifest.package_hash);
  assert.equal(dataset.meta.source, 'bundled');
  assert.deepEqual(await departuresAtA(store), ['T1', 'T2']);
  assert.deepEqual((await store.packages()).map(entry => entry.role), ['active']);
  assert.equal(databases().length, 1);
});

test('verified download switches atomically and keeps the previous package for rollback', async () => {
  const { store, serve, databases, files } = harness();
  await store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  const installed = await store.installDownloaded(next.manifest, serve(next.manifest, next.text));
  assert.equal(installed.meta.packageHash, next.manifest.package_hash);
  assert.deepEqual(await departuresAtA(store), ['N20261021-T1', 'N20261021-T2'], 'stops and trips come from the new package');
  assert.deepEqual((await store.packages()).map(entry => `${entry.role}:${entry.hash === bundledManifest.package_hash ? 'bundled' : 'new'}`).sort(), ['active:new', 'previous:bundled']);
  const third = release('20261022', '2026-10-22T03:15:00Z');
  await store.installDownloaded(third.manifest, serve(third.manifest, third.text));
  assert.equal(databases().length, 2, 'the package two generations back is deleted');
  assert.deepEqual(await files.list(), [], 'staging is cleaned');
  const rolledBack = await store.rollback();
  assert.equal(rolledBack?.meta.packageHash, next.manifest.package_hash);
});

test('hash mismatch, invalid content and full storage leave the active package intact', async () => {
  const { store, serve, databases, files } = harness();
  await store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  const url = serve(next.manifest, next.text.replace('Fermata 101', 'Fermata 999'));
  await assert.rejects(store.installDownloaded(next.manifest, url), (error: unknown) => error instanceof PackageError && error.kind === 'hash');
  const broken = release('20261021', '2026-10-21T03:15:00Z', pkg => { pkg.trips.pattern[0] = 999; });
  await assert.rejects(store.installDownloaded(broken.manifest, serve(broken.manifest, broken.text)), (error: unknown) => error instanceof PackageError && error.kind === 'invalid');
  files.setFree(1000);
  await assert.rejects(store.installDownloaded(next.manifest, serve(next.manifest, next.text)), (error: unknown) => error instanceof PackageError && error.kind === 'storage');
  assert.equal(store.active()?.meta.packageHash, bundledManifest.package_hash);
  assert.deepEqual(await departuresAtA(store), ['T1', 'T2']);
  assert.equal(databases().length, 1, 'no candidate database is left behind');
  assert.deepEqual(await files.list(), []);
});

test('SQLITE_FULL during import rolls the candidate back', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  const full = harness(directory, { failRunAfter: 5 });
  await full.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await assert.rejects(full.store.installDownloaded(next.manifest, full.serve(next.manifest, next.text)), (error: unknown) => error instanceof PackageError && error.kind === 'storage');
  assert.equal(full.store.active()?.meta.packageHash, bundledManifest.package_hash);
  assert.equal(full.databases().length, 1);
});

test('process death leftovers are removed and the registry still points at the intact package', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  // A crash mid-import leaves an unregistered candidate and a partial download.
  fs.writeFileSync(path.join(directory, 'db', 'gtt-0123456789abcdef-1.db'), 'partial');
  fs.writeFileSync(path.join(directory, 'files', `gtt-${'b'.repeat(64)}.json.part`), '{"trunc');
  const restarted = harness(directory);
  const dataset = await restarted.store.open();
  assert.equal(dataset.meta.packageHash, bundledManifest.package_hash);
  assert.equal(restarted.databases().length, 1);
  assert.deepEqual(await restarted.files.list(), []);
});

test('a corrupted active database rolls back to the previous package, then to the bundled one', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await first.store.installDownloaded(next.manifest, first.serve(next.manifest, next.text));
  const active = (await first.store.packages()).find(entry => entry.role === 'active')!;
  fs.writeFileSync(first.driver.file(active.db), 'this is not a database'.repeat(100));
  const second = harness(directory);
  assert.equal((await second.store.open()).meta.packageHash, bundledManifest.package_hash, 'previous package restored');
  assert.deepEqual((await second.store.packages()).map(entry => entry.role), ['active']);
  const restored = (await second.store.packages())[0]!;
  fs.writeFileSync(second.driver.file(restored.db), 'corrupt again'.repeat(100));
  const third = harness(directory);
  const reinstalled = await third.store.open();
  assert.equal(reinstalled.meta.packageHash, bundledManifest.package_hash);
  assert.deepEqual(await departuresAtA(third.store), ['T1', 'T2'], 'bundled package reimported');
});

test('startup rejects a structurally damaged database (missing table or index, wrong counts) and rolls back', async () => {
  for (const damage of ['DROP TABLE timing_vector', 'DROP INDEX trip_by_pattern', "DELETE FROM trip WHERE trip_id LIKE 'N%X0%'",
    "UPDATE dataset_meta SET value = '{not json' WHERE key = 'manifest'", "UPDATE dataset_meta SET value = '{}' WHERE key = 'manifest'"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
    const first = harness(directory);
    await first.store.open();
    const next = release('20261021', '2026-10-21T03:15:00Z');
    await first.store.installDownloaded(next.manifest, first.serve(next.manifest, next.text));
    const active = (await first.store.packages()).find(entry => entry.role === 'active')!;
    const db = await first.driver.open(active.db); await db.exec(damage); await db.close();
    const restarted = harness(directory);
    const dataset = await restarted.store.open();
    assert.equal(dataset.meta.packageHash, bundledManifest.package_hash, damage);
    assert.deepEqual(await departuresAtA(restarted.store), ['T1', 'T2'], `${damage}: queries work after rollback`);
  }
});

test('bundled bytes are verified against the bundled manifest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const tampered = harness(directory, { bundled: { manifest: bundledManifest, text: bundledText.replace('ALFA', 'ALFB') } });
  await assert.rejects(tampered.store.open(), (error: unknown) => error instanceof PackageError && error.kind === 'hash');
});

test('mirrors: a failed or corrupt transfer falls through to the next URL', async () => {
  const { store, serve, files } = harness();
  await store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  const [corrupt] = serve(next.manifest, next.text.slice(0, -10), 'https://a.test/');
  const [good] = serve(next.manifest, next.text, 'https://b.test/');
  const installed = await store.installDownloaded(next.manifest, ['https://down.test/' + next.manifest.package_path, corrupt!, good!]);
  assert.equal(installed.meta.packageHash, next.manifest.package_hash);
  assert.deepEqual(files.requested, ['https://down.test/' + next.manifest.package_path, corrupt, good], 'tried in order');
});

test('a full disk while creating the schema or indexes leaves the active package intact', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  await harness(directory).store.open();
  const full = harness(directory, { failRunAfter: 0 });
  await full.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await assert.rejects(full.store.installDownloaded(next.manifest, full.serve(next.manifest, next.text)), (error: unknown) => error instanceof PackageError && error.kind === 'storage');
  assert.equal(full.store.active()?.meta.packageHash, bundledManifest.package_hash);
  assert.equal(full.databases().length, 1);
});

test('an APK with a newer bundled package replaces an older download; an older one does not', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await first.store.installDownloaded(next.manifest, first.serve(next.manifest, next.text));
  const reopened = harness(directory);
  assert.equal((await reopened.store.open()).meta.packageHash, next.manifest.package_hash, 'older bundled package ignored');
  const shipped = release('20261025', '2026-10-25T03:15:00Z');
  const upgraded = harness(directory, { bundled: { manifest: shipped.manifest, text: shipped.text } });
  const dataset = await upgraded.store.open();
  assert.equal(dataset.meta.packageHash, shipped.manifest.package_hash, 'newer bundled package installed');
  assert.equal(dataset.meta.source, 'bundled');
  const fullDisk = harness(directory, { free: 10, bundled: { manifest: release('20261026', '2026-10-26T03:15:00Z').manifest, text: release('20261026', '2026-10-26T03:15:00Z').text } });
  assert.equal((await fullDisk.store.open()).meta.packageHash, shipped.manifest.package_hash, 'a bundled import failure keeps the active package');
});

test('representative-query validation rejects a candidate that answers differently', async () => {
  const pkg = fixturePackage();
  const meta = datasetMeta(pkg, bundledManifest, 'bundled');
  const oracle = createMemoryReader(pkg, meta);
  await compareRepresentativeQueries(oracle, oracle, pkg, rome('20261021', '07:00'));
  const tampered = { ...oracle, async vectors(ids: readonly number[]) { const map = await oracle.vectors(ids); for (const vector of map.values()) vector.departures = vector.departures.map(value => value + 60); return map; } };
  await assert.rejects(compareRepresentativeQueries(tampered, oracle, pkg, rome('20261021', '07:00')), PackageError);
});

test('a transient open error keeps the active package; real damage rolls back and is reported', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await first.store.installDownloaded(next.manifest, first.serve(next.manifest, next.text));
  const flaky = harness(directory);
  const open = flaky.driver.open.bind(flaky.driver); let failures = 1;
  flaky.driver.open = async name => { if (name !== 'gtt-registry.db' && failures-- > 0) throw new Error('SQLITE_BUSY: database is locked'); return open(name); };
  await assert.rejects(flaky.store.open(), /SQLITE_BUSY/);
  assert.equal((await flaky.store.packages()).find(entry => entry.role === 'active')?.hash, next.manifest.package_hash, 'registry untouched');
  assert.equal((await flaky.store.open()).meta.packageHash, next.manifest.package_hash, 'the retry opens it');
  assert.equal(flaky.store.rolledBack(), false);
  const active = (await flaky.store.packages()).find(entry => entry.role === 'active')!;
  fs.writeFileSync(flaky.driver.file(active.db), 'damaged'.repeat(500));
  const damaged = harness(directory);
  assert.equal((await damaged.store.open()).meta.packageHash, bundledManifest.package_hash);
  assert.equal(damaged.store.rolledBack(), true);
});

test('a transient error opening the retained package during rollback keeps it for a retry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-store-'));
  const first = harness(directory);
  await first.store.open();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  await first.store.installDownloaded(next.manifest, first.serve(next.manifest, next.text));
  const previous = (await first.store.packages()).find(entry => entry.role === 'previous')!;
  const busy = harness(directory);
  const open = busy.driver.open.bind(busy.driver); let failures = 1;
  busy.driver.open = async name => { if (name === previous.db && failures-- > 0) throw new Error('SQLITE_BUSY: database is locked'); return open(name); };
  await assert.rejects(busy.store.rollback(), /SQLITE_BUSY/);
  assert.ok(busy.databases().includes(previous.db), 'the retained database file is kept');
  assert.equal((await busy.store.packages()).find(entry => entry.role === 'active')?.db, previous.db, 'and registered as active');
  assert.equal((await busy.store.open()).meta.packageHash, bundledManifest.package_hash, 'the retry opens it');
});

test('a candidate that cannot be reopened never becomes the registered active package', async () => {
  const { store, driver, serve, databases } = harness();
  await store.open();
  const before = databases();
  const next = release('20261021', '2026-10-21T03:15:00Z');
  const open = driver.open.bind(driver); const opened = new Map<string, number>();
  driver.open = async name => {
    const count = (opened.get(name) ?? 0) + 1; opened.set(name, count);
    if (name.startsWith(`gtt-${next.manifest.package_hash.slice(0, 16)}`) && count === 2) throw new Error('SQLITE_BUSY: database is locked');
    return open(name);
  };
  await assert.rejects(store.installDownloaded(next.manifest, serve(next.manifest, next.text)), /SQLITE_BUSY/);
  assert.deepEqual((await store.packages()).map(entry => [entry.role, entry.hash]), [['active', bundledManifest.package_hash]]);
  assert.equal(store.active()?.meta.packageHash, bundledManifest.package_hash, 'memory and registry agree');
  assert.deepEqual(databases(), before, 'the candidate file is removed');
});

test('identity lookups are chunked and match first arrival or first departure in SQL', async () => {
  const { store } = harness();
  const { reader } = await store.open();
  const identities = Array.from({ length: 250 }, (_, index) => ({ routeId: '4U', direction: 0, shapeId: '4A', start: 8 * 3600 + index }));
  const trips = await reader.tripsByIdentity(identities);
  assert.ok(trips.some(trip => trip.tripId === 'T1'), '1,000 bound values would exceed a single statement on older SQLite builds');
  assert.equal(trips.find(trip => trip.tripId === 'T1')?.firstDeparture, 8 * 3600);
});
