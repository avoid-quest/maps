// Minimal ambient types for Bun's built-in SQLite, used only by tests (Bun types are not installed).
declare module 'bun:sqlite' {
  interface Statement<T> { all(...params: unknown[]): T[]; run(...params: unknown[]): unknown; finalize(): void }
  export class Database {
    constructor(filename?: string, options?: { create?: boolean; readwrite?: boolean; strict?: boolean });
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }
}
