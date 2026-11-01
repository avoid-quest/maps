/** Minimal async SQL surface implemented by expo-sqlite on device and bun:sqlite in tests. */
export type SqlValue = string | number | null;
export interface SqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Commits only if the task resolves; any thrown error rolls the whole task back. */
  transaction(task: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
export interface SqlDriver {
  open(name: string): Promise<SqlDatabase>;
  /** Removes the database file and its journal/WAL siblings; missing files are not an error. */
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');
