import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { SqlDatabase, SqlDriver, SqlValue } from '../sql';

/** bun:sqlite implementation of the store's SQL surface; `faults` simulates a full disk or crash. */
export function createBunDriver(directory: string, faults: { failRunAfter?: number; failOn?: (name: string) => boolean } = {}): SqlDriver & { file(name: string): string; open(name: string): Promise<SqlDatabase> } {
  fs.mkdirSync(directory, { recursive: true });
  let runs = 0;
  const file = (name: string) => path.join(directory, name);
  return {
    file,
    async open(name) {
      const db = new Database(file(name), { create: true });
      const wrapped: SqlDatabase = {
        async exec(sql) { db.exec(sql); },
        async run(sql, params = []) {
          if (faults.failOn?.(name) && faults.failRunAfter !== undefined && ++runs > faults.failRunAfter) throw new Error('database or disk is full (SQLITE_FULL)');
          const prepared = db.prepare(sql); prepared.run(...params); prepared.finalize();
        },
        async all<T>(sql: string, params: readonly SqlValue[] = []) { const prepared = db.prepare<T>(sql); const rows = prepared.all(...params); prepared.finalize(); return rows; },
        async transaction(task) {
          db.exec('BEGIN');
          try { await task(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
        },
        async close() { db.close(); },
      };
      return wrapped;
    },
    async remove(name) { for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(file(name + suffix), { force: true }); },
    async list() { return fs.readdirSync(directory); },
  };
}
