import { romeDate, withinCoverage } from './calendar';
import { checkManifestMatchesPackage, PackageError, validateManifest, validatePackage, type PackageManifest, type TimetablePackage } from './package-format';
import { createMemoryReader, maxTripSeconds, type DatasetMeta, type TimetableReader } from './reader';
import { INITIAL_REFRESH_STATE, type RefreshState } from './refresh-policy';
import { scheduledEvents } from './scheduled-board';
import type { SqlDatabase, SqlDriver } from './sql';
import { createSqlReader, importPackage, readMeta, validateDatabase } from './timetable-db';

/** Staging storage for downloaded packages (expo-file-system on device, node:fs in tests). */
export interface PackageFiles {
  /** Plain GET into a staging file: no identifiers, query parameters or custom headers. */
  download(url: string, name: string): Promise<void>;
  read(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
  /** Free bytes on the data volume, when the platform reports it. */
  freeBytes(): Promise<number | undefined>;
}
export type Sha256 = (text: string) => Promise<string>;
export interface BundledPackage { manifest: PackageManifest; load(): TimetablePackage }
export interface ActiveDataset { reader: TimetableReader; meta: DatasetMeta }

const REGISTRY = 'gtt-registry.db';
const DATABASE = /^gtt-[0-9a-f]{16}-\d+\.db$/;
const STAGING = /^gtt-[0-9a-f]{64}\.json(\.part)?$/;
/** A candidate database needs roughly this multiple of the JSON size while importing. */
const STORAGE_FACTOR = 6;

type PackageRow = { package_hash: string; db_name: string; role: 'active' | 'previous'; manifest: string; source: string };

/**
 * Owns the on-device package lifecycle: import into a candidate database, validate references and
 * representative queries against the package itself, then switch in one registry transaction.
 * The previous package is retained for rollback. Failure at any point — including process death
 * or a full disk — leaves the registry pointing at the intact active database.
 */
export function createPackageStore(deps: { driver: SqlDriver; files: PackageFiles; sha256: Sha256; bundled: BundledPackage; now?: () => number; closeLater?: (db: SqlDatabase) => void }) {
  const { driver, files, sha256, bundled } = deps;
  const now = deps.now ?? Date.now;
  const closeLater = deps.closeLater ?? (db => { const timer = setTimeout(() => void db.close().catch(() => undefined), 30_000); (timer as { unref?: () => void }).unref?.(); });
  let registry: SqlDatabase | undefined;
  let active: (ActiveDataset & { db: SqlDatabase }) | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => { const next = queue.catch(() => undefined).then(task); queue = next; return next; };

  async function openRegistry() {
    if (registry) return registry;
    const db = await driver.open(REGISTRY);
    await db.exec(`CREATE TABLE IF NOT EXISTS package (package_hash TEXT NOT NULL, db_name TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('active','previous')), installed_at INTEGER NOT NULL, source TEXT NOT NULL, manifest TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS package_role ON package (role);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return registry = db;
  }
  async function rows(): Promise<PackageRow[]> { return (await openRegistry()).all<PackageRow>('SELECT package_hash, db_name, role, manifest, source FROM package'); }

  async function openDataset(row: PackageRow): Promise<ActiveDataset & { db: SqlDatabase }> {
    const db = await driver.open(row.db_name);
    try {
      const meta = await readMeta(db);
      if (meta.packageHash !== row.package_hash) throw new PackageError('Database orari non corrispondente al registro.');
      const reader = createSqlReader(db, meta);
      // A cheap read of every hot table catches truncation without a full integrity scan.
      await Promise.all([reader.routes(), reader.stopVisits(''), reader.trips(['']), reader.calendar([])]);
      return { db, meta, reader };
    } catch (error) { await db.close().catch(() => undefined); throw error; }
  }

  /** Remove databases and staging files that no registry row references (crash leftovers). */
  async function cleanup(keep: Set<string> = new Set()) {
    const referenced = new Set((await rows()).map(row => row.db_name));
    for (const name of await driver.list()) if (DATABASE.test(name) && !referenced.has(name) && !keep.has(name)) await driver.remove(name).catch(() => undefined);
    for (const name of await files.list()) if (STAGING.test(name) && !keep.has(name)) await files.remove(name).catch(() => undefined);
  }

  async function install(pkg: TimetablePackage, manifest: PackageManifest, source: DatasetMeta['source']): Promise<ActiveDataset> {
    checkManifestMatchesPackage(manifest, pkg);
    const free = await files.freeBytes();
    if (free !== undefined && free < manifest.package_bytes * STORAGE_FACTOR) throw new PackageError('Spazio di archiviazione insufficiente per aggiornare gli orari.', 'storage');
    const meta: DatasetMeta = { packageHash: manifest.package_hash, feedVersion: pkg.feed.feed_version, validFrom: pkg.feed.valid_from, validTo: pkg.feed.valid_to, maxTripSeconds: maxTripSeconds(pkg), source, manifest };
    const name = `gtt-${manifest.package_hash.slice(0, 16)}-${now()}.db`;
    await driver.remove(name);
    let candidate: SqlDatabase | undefined;
    try {
      candidate = await driver.open(name);
      await importPackage(candidate, pkg, meta);
      await validateDatabase(candidate, pkg);
      await compareRepresentativeQueries(createSqlReader(candidate, meta), createMemoryReader(pkg, meta), pkg, now());
      await candidate.close(); candidate = undefined;
    } catch (error) {
      await candidate?.close().catch(() => undefined);
      await driver.remove(name).catch(() => undefined);
      if (/full|SQLITE_FULL|ENOSPC|disk/i.test(String((error as Error)?.message))) throw new PackageError('Spazio di archiviazione insufficiente per aggiornare gli orari.', 'storage');
      throw error;
    }
    const registryDb = await openRegistry();
    const before = await rows();
    const retired = before.find(row => row.role === 'previous');
    await registryDb.transaction(async () => {
      await registryDb.run("DELETE FROM package WHERE role = 'previous'");
      await registryDb.run("UPDATE package SET role = 'previous' WHERE role = 'active'");
      await registryDb.run("INSERT INTO package (package_hash, db_name, role, installed_at, source, manifest) VALUES (?, ?, 'active', ?, ?, ?)", [manifest.package_hash, name, now(), source, JSON.stringify(manifest)]);
    });
    if (retired) await driver.remove(retired.db_name).catch(() => undefined);
    const next = await openDataset({ package_hash: manifest.package_hash, db_name: name, role: 'active', manifest: JSON.stringify(manifest), source });
    if (active) closeLater(active.db);
    active = next;
    return next;
  }

  async function rollback(): Promise<ActiveDataset | undefined> {
    const registryDb = await openRegistry();
    const all = await rows();
    const current = all.find(row => row.role === 'active'); const previous = all.find(row => row.role === 'previous');
    await registryDb.transaction(async () => {
      if (current) await registryDb.run('DELETE FROM package WHERE db_name = ?', [current.db_name]);
      if (previous) await registryDb.run("UPDATE package SET role = 'active' WHERE db_name = ?", [previous.db_name]);
    });
    if (current) await driver.remove(current.db_name).catch(() => undefined);
    if (!previous) return undefined;
    try { return active = await openDataset({ ...previous, role: 'active' }); } catch {
      await registryDb.run('DELETE FROM package WHERE db_name = ?', [previous.db_name]);
      await driver.remove(previous.db_name).catch(() => undefined);
      return undefined;
    }
  }

  async function installBundled() {
    return install(validatePackage(bundled.load()), validateManifest(bundled.manifest), 'bundled');
  }

  return {
    /** Opens the active package, rolling back or reinstalling the bundled package when it is unusable. */
    open: () => serial(async (): Promise<ActiveDataset> => {
      if (active) return active;
      await cleanup();
      const current = (await rows()).find(row => row.role === 'active');
      let dataset: ActiveDataset | undefined;
      if (current) {
        try { dataset = active = await openDataset(current); } catch { dataset = await rollback(); }
      }
      if (!dataset) return installBundled();
      // An app update can ship a newer bundled package than the last download; if importing it
      // fails (for example on a full disk) the usable active package stays in service.
      if (Date.parse(bundled.manifest.built_at) > Date.parse(dataset.meta.manifest.built_at)) {
        try { dataset = await installBundled(); } catch { /* keep the active package */ }
      }
      return dataset;
    }),
    active: () => active,
    /** Verify the downloaded bytes against the manifest hash before parsing or importing anything. */
    installDownloaded: (manifest: PackageManifest, url: string) => serial(async (): Promise<ActiveDataset> => {
      const staging = `gtt-${manifest.package_hash}.json`;
      await files.remove(`${staging}.part`).catch(() => undefined);
      try {
        await files.download(url, `${staging}.part`);
        const text = await files.read(`${staging}.part`);
        if (text.length !== manifest.package_bytes || await sha256(text) !== manifest.package_hash) throw new PackageError('Il pacchetto orari scaricato non corrisponde all’hash pubblicato.', 'hash');
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new PackageError('Il pacchetto orari scaricato non è JSON valido.'); }
        return await install(validatePackage(parsed), manifest, 'downloaded');
      } finally { await files.remove(`${staging}.part`).catch(() => undefined); }
    }),
    rollback: () => serial(rollback),
    async readState(): Promise<RefreshState> {
      const [row] = await (await openRegistry()).all<{ value: string }>("SELECT value FROM state WHERE key = 'refresh'");
      try { return row ? { ...INITIAL_REFRESH_STATE, ...JSON.parse(row.value) } : INITIAL_REFRESH_STATE; } catch { return INITIAL_REFRESH_STATE; }
    },
    async writeState(state: RefreshState) {
      await (await openRegistry()).run("INSERT OR REPLACE INTO state (key, value) VALUES ('refresh', ?)", [JSON.stringify(state)]);
    },
    async packages() { return (await rows()).map(row => ({ hash: row.package_hash, role: row.role, source: row.source, db: row.db_name })); },
  };
}
export type PackageStore = ReturnType<typeof createPackageStore>;

/**
 * The candidate database must answer like the package it came from: compare scheduled boards
 * for the busiest stop, a metro stop and a repeated-visit stop, plus a trip lookup.
 */
export async function compareRepresentativeQueries(candidate: TimetableReader, oracle: TimetableReader, pkg: TimetablePackage, now: number) {
  const visits = new Map<number, number>();
  for (const pattern of pkg.patterns) for (const ref of pattern[0]) visits.set(ref, (visits.get(ref) ?? 0) + 1);
  const busiest = [...visits].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const metro = pkg.trips.route.findIndex(route => pkg.routes[route]![2] === 1);
  const repeated = pkg.patterns.find(pattern => new Set(pattern[0]).size < pattern[0].length);
  const stopRefs = [busiest, metro >= 0 ? pkg.patterns[pkg.trips.pattern[metro]!]![0][1] : undefined, repeated?.[0].find((ref, index, refs) => refs.indexOf(ref) !== index)]
    .filter((ref): ref is number => ref !== undefined);
  const today = romeDate(now);
  const date = withinCoverage(today, pkg.feed.valid_from, pkg.feed.valid_to) ? today : pkg.feed.valid_from;
  const at = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6), 6, 30);
  const signature = (result: Awaited<ReturnType<typeof scheduledEvents>>) => result.events
    .map(event => `${event.trip.tripId}|${event.serviceDate}|${event.position}|${event.scheduledAt ?? event.frequency?.from}`).sort().join('\n');
  for (const ref of stopRefs) {
    const stopId = pkg.stops[ref]![0];
    const window = { lookbackMs: 0, horizonMs: 18 * 3_600_000 };
    const [left, right] = await Promise.all([scheduledEvents(candidate, stopId, at, window), scheduledEvents(oracle, stopId, at, window)]);
    if (signature(left) !== signature(right)) throw new PackageError(`Verifica delle query fallita per la fermata ${stopId}.`);
  }
  const sample = [pkg.trips.trip_id[0]!, pkg.trips.trip_id.at(-1)!, ...(metro >= 0 ? [pkg.trips.trip_id[metro]!] : [])];
  const [left, right] = await Promise.all([candidate.trips(sample), oracle.trips(sample)]);
  const ordered = (trips: Map<string, unknown>) => JSON.stringify([...trips].sort(([a], [b]) => a.localeCompare(b)));
  if (ordered(left) !== ordered(right) || left.size !== new Set(sample).size) throw new PackageError('Verifica delle corse fallita.');
}
