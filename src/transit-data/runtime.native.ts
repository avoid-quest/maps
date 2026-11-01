import { Asset } from 'expo-asset';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { defaultDatabaseDirectory, deleteDatabaseAsync, openDatabaseAsync, type SQLiteBindParams, type SQLiteDatabase } from 'expo-sqlite';
import { diagnostics } from '../services/diagnostics';
import bundledAsset from '../data/gtt-timetable.gttpkg';
import { bundledManifest } from './bundled';
import { createPackageStore, type BundledPackage, type PackageFiles } from './package-store';
import { createTimetableService } from './service';
import type { SqlDatabase, SqlDriver } from './sql';

function wrap(db: SQLiteDatabase): SqlDatabase {
  return {
    exec: sql => db.execAsync(sql),
    run: async (sql, params = []) => { await db.runAsync(sql, params as SQLiteBindParams); },
    all: (sql, params = []) => db.getAllAsync(sql, params as SQLiteBindParams),
    transaction: task => db.withTransactionAsync(task),
    close: () => db.closeAsync(),
  };
}
const databaseDirectory = () => {
  const directory = String(defaultDatabaseDirectory);
  return new Directory(directory.startsWith('file:') ? directory : `file://${directory}`);
};
const driver: SqlDriver = {
  open: async name => wrap(await openDatabaseAsync(name)),
  remove: async name => { await deleteDatabaseAsync(name).catch(() => undefined); },
  list: async () => { const directory = databaseDirectory(); return directory.exists ? directory.list().map(entry => entry.name) : []; },
};
const packages = new Directory(Paths.document, 'gtt-packages');
const files: PackageFiles = {
  async download(url, name) {
    packages.create({ intermediates: true, idempotent: true });
    // No custom headers: the request carries only what HTTP and the platform client require.
    await File.downloadFileAsync(url, new File(packages, name), { idempotent: true });
  },
  read: name => new File(packages, name).text(),
  remove: async name => { const file = new File(packages, name); if (file.exists) file.delete(); },
  list: async () => packages.exists ? packages.list().map(entry => entry.name) : [],
  freeBytes: async () => { try { return Paths.availableDiskSpace; } catch { return undefined; } },
};

/** The APK's package asset, copied to the cache by expo-asset, read once for import and then deleted. */
const bundled: BundledPackage = {
  manifest: bundledManifest,
  async load() {
    const asset = Asset.fromModule(bundledAsset);
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Pacchetto orari incluso non disponibile.');
    const file = new File(asset.localUri);
    try { return await file.text(); } finally {
      // Only a cache copy is removed; the APK keeps the original asset.
      if (asset.localUri.startsWith(Paths.cache.uri)) { try { file.delete(); } catch { /* the cache is reclaimable anyway */ } }
    }
  },
};

export const timetableService = createTimetableService({
  store: createPackageStore({ driver, files, bundled, sha256: text => digestStringAsync(CryptoDigestAlgorithm.SHA256, text) }),
  fetch: (input, init) => fetch(input, init),
  async networkAllowed(wifiOnly) {
    // Any connection is allowed by default; only the Wi-Fi-only preference needs the network type.
    if (!wifiOnly) return true;
    const state = await getNetworkStateAsync();
    return state.isConnected !== false && (state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET);
  },
  events: { record: state => diagnostics.record({ type: 'timetable', state }) },
});
