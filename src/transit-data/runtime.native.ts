import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { defaultDatabaseDirectory, deleteDatabaseAsync, openDatabaseAsync, type SQLiteBindParams, type SQLiteDatabase } from 'expo-sqlite';
import { diagnostics } from '../services/diagnostics';
import { bundledPackage } from './bundled';
import { createPackageStore, type PackageFiles } from './package-store';
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

export const timetableService = createTimetableService({
  store: createPackageStore({ driver, files, bundled: bundledPackage, sha256: text => digestStringAsync(CryptoDigestAlgorithm.SHA256, text) }),
  fetch: (input, init) => fetch(input, init),
  async networkAllowed(wifiOnly) {
    const state = await getNetworkStateAsync();
    if (state.isConnected === false) return false;
    return !wifiOnly || state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET;
  },
  events: { record: state => diagnostics.record({ type: 'timetable', state }) },
});
