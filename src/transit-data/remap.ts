import { activeServiceIds, type CalendarException, type CalendarRow } from './calendar';
import { placeholders, type SqlDatabase } from './sql';
import { csvRows, readCentralDirectory, readMembers, ZipRangeError, type CentralDirectory, type RangeTransport } from './zip-range';

/**
 * GTT re-issues trip IDs in bulk for unchanged trips (calendar re-cuts clone trips under new
 * trip/service IDs). A remap reads only `trips.txt`, `calendar*.txt` and `feed_info.txt` from
 * GTT's current export (~0.4 MB of ranged reads) to translate a live trip_id into its schedule
 * identity — route, direction, shape — plus the service dates on which it runs.
 */
export interface RemapTrip { routeId: string; direction: number; shapeId: string; serviceId: string }
export interface RemapMeta {
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
  feedVersion?: string;
  /** CRC-32 of every member listed in GTT's central directory (hex). */
  crc32: Record<string, string>;
  trips: number;
}
export const REMAP_MEMBERS = ['trips.txt', 'calendar.txt', 'calendar_dates.txt', 'feed_info.txt'] as const;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export interface RemapData { meta: RemapMeta; trips: Map<string, RemapTrip>; calendar: CalendarRow[]; exceptions: CalendarException[] }

/** Parse the remap members already fetched from the directory. */
export async function fetchRemapMembers(transport: RangeTransport, url: string, directory: CentralDirectory, now: number): Promise<{ data: RemapData; bytes: number }> {
  const trips = new Map<string, RemapTrip>(); const calendar: CalendarRow[] = []; const exceptions: CalendarException[] = [];
  let feedVersion: string | undefined;
  const parsers: Record<string, (chunk: string, final: boolean) => void> = {
    // Record limits well above GTT's ~61k trips, ~400 services and ~10k exceptions.
    'trips.txt': csvRows(row => {
      if (!row.trip_id || !row.route_id || !row.service_id) return;
      trips.set(row.trip_id, { routeId: row.route_id, direction: row.direction_id === '' || row.direction_id === undefined ? -1 : Number(row.direction_id), shapeId: row.shape_id ?? '', serviceId: row.service_id });
    }, { maxRows: 400_000, maxLineLength: 4096 }),
    'calendar.txt': csvRows(row => {
      calendar.push({ serviceId: row.service_id!, mask: WEEKDAYS.reduce((mask, day, bit) => mask | (row[day] === '1' ? 1 << bit : 0), 0), start: row.start_date!, end: row.end_date! });
    }, { maxRows: 20_000, maxLineLength: 1024 }),
    'calendar_dates.txt': csvRows(row => {
      if (row.exception_type === '1' || row.exception_type === '2') exceptions.push({ serviceId: row.service_id!, date: row.date!, added: row.exception_type === '1' });
    }, { maxRows: 500_000, maxLineLength: 1024 }),
    'feed_info.txt': csvRows(row => { feedVersion = row.feed_version || feedVersion; }, { maxRows: 10, maxLineLength: 4096 }),
  };
  const present = REMAP_MEMBERS.filter(name => name !== 'feed_info.txt' || directory.entries.has(name));
  const bytes = await readMembers(transport, url, directory, present, (name, chunk, final) => parsers[name]!(chunk, final));
  if (trips.size < 1000) throw new ZipRangeError('trips.txt GTT troppo piccolo: remap rifiutato.');
  const crc32 = Object.fromEntries([...directory.entries.values()].map(entry => [entry.name, entry.crc32]));
  return {
    data: { meta: { fetchedAt: now, etag: directory.etag, lastModified: directory.lastModified, feedVersion, crc32, trips: trips.size }, trips, calendar, exceptions },
    bytes,
  };
}

/** Persistent remap (SQLite on device, bun:sqlite in tests) or in memory. */
export interface RemapStore {
  meta(): Promise<RemapMeta | undefined>;
  replace(data: RemapData): Promise<void>;
  lookup(tripIds: readonly string[]): Promise<Map<string, RemapTrip>>;
  /** Whether a remapped service runs on a date according to GTT's current calendar. */
  activeServices(date: string): Promise<Set<string>>;
  /** The calendar.txt row of a remapped service (weekday mask and date range), if any. */
  calendarRow(serviceId: string): Promise<CalendarRow | undefined>;
  readState(): Promise<RemapState>;
  writeState(state: RemapState): Promise<void>;
  /** Discard the stored remap (damaged or unreadable); the next refresh rebuilds it. */
  reset(): Promise<void>;
  close?(): Promise<void>;
}
export interface RemapState { lastAttemptAt?: number; lastSuccessAt?: number; lastCheckAt?: number; failures: number }

export function createMemoryRemapStore(): RemapStore {
  let data: RemapData | undefined; let state: RemapState = { failures: 0 };
  return {
    async meta() { return data?.meta; },
    async replace(next) { data = next; },
    async lookup(ids) { return new Map(ids.flatMap(id => { const trip = data?.trips.get(id); return trip ? [[id, trip] as const] : []; })); },
    async activeServices(date) { return data ? activeServiceIds(data.calendar, data.exceptions, date) : new Set(); },
    async calendarRow(serviceId) { return data?.calendar.find(row => row.serviceId === serviceId); },
    async readState() { return state; },
    async writeState(next) { state = next; },
    async reset() { data = undefined; state = { failures: 0 }; },
  };
}

export async function createSqlRemapStore(db: SqlDatabase): Promise<RemapStore> {
  // An unreadable or damaged file is refused here, so the caller can delete and recreate it.
  const [check] = await db.all<Record<string, string>>('PRAGMA quick_check');
  if (Object.values(check ?? {})[0] !== 'ok') throw new Error('remap database damaged');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS remap_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS remap_trip (trip_id TEXT PRIMARY KEY, route_id TEXT NOT NULL, direction INTEGER NOT NULL, shape_id TEXT NOT NULL, service_id TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS remap_calendar (service_id TEXT PRIMARY KEY, weekday_mask INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS remap_exception (date TEXT NOT NULL, service_id TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (date, service_id)) WITHOUT ROWID;`);
  const getValue = async (key: string) => (await db.all<{ value: string }>('SELECT value FROM remap_meta WHERE key = ?', [key]))[0]?.value;
  const insert = async (table: string, columns: string[], rows: (string | number)[][]) => {
    const batch = Math.floor(900 / columns.length);
    for (let at = 0; at < rows.length; at += batch) {
      const slice = rows.slice(at, at + batch);
      await db.run(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES ${slice.map(() => `(${placeholders(columns.length)})`).join(',')}`, slice.flat());
    }
  };
  return {
    async meta() { const value = await getValue('meta'); return value ? JSON.parse(value) as RemapMeta : undefined; },
    async replace(data) {
      // One transaction: a crash or full disk leaves the previous remap intact.
      await db.transaction(async () => {
        await db.exec('DELETE FROM remap_trip; DELETE FROM remap_calendar; DELETE FROM remap_exception;');
        await insert('remap_trip', ['trip_id', 'route_id', 'direction', 'shape_id', 'service_id'], [...data.trips].map(([id, trip]) => [id, trip.routeId, trip.direction, trip.shapeId, trip.serviceId]));
        await insert('remap_calendar', ['service_id', 'weekday_mask', 'start_date', 'end_date'], data.calendar.map(row => [row.serviceId, row.mask, row.start, row.end]));
        await insert('remap_exception', ['date', 'service_id', 'added'], data.exceptions.map(row => [row.date, row.serviceId, row.added ? 1 : 0]));
        await db.run("INSERT OR REPLACE INTO remap_meta (key, value) VALUES ('meta', ?)", [JSON.stringify(data.meta)]);
      });
    },
    async lookup(ids) {
      if (!ids.length) return new Map();
      const rows = await db.all<{ trip_id: string; route_id: string; direction: number; shape_id: string; service_id: string }>(
        `SELECT * FROM remap_trip WHERE trip_id IN (${placeholders(ids.length)})`, [...ids]);
      return new Map(rows.map(row => [row.trip_id, { routeId: row.route_id, direction: row.direction, shapeId: row.shape_id, serviceId: row.service_id }]));
    },
    async activeServices(date) {
      const rows = await db.all<{ service_id: string; weekday_mask: number; start_date: string; end_date: string }>('SELECT * FROM remap_calendar');
      const exceptions = await db.all<{ service_id: string; date: string; added: number }>('SELECT * FROM remap_exception WHERE date = ?', [date]);
      return activeServiceIds(rows.map(row => ({ serviceId: row.service_id, mask: row.weekday_mask, start: row.start_date, end: row.end_date })),
        exceptions.map(row => ({ serviceId: row.service_id, date: row.date, added: row.added === 1 })), date);
    },
    async calendarRow(serviceId) {
      const [row] = await db.all<{ service_id: string; weekday_mask: number; start_date: string; end_date: string }>('SELECT * FROM remap_calendar WHERE service_id = ?', [serviceId]);
      return row ? { serviceId: row.service_id, mask: row.weekday_mask, start: row.start_date, end: row.end_date } : undefined;
    },
    async readState() { const value = await getValue('state'); try { return value ? { failures: 0, ...JSON.parse(value) } : { failures: 0 }; } catch { return { failures: 0 }; } },
    async writeState(state) { await db.run("INSERT OR REPLACE INTO remap_meta (key, value) VALUES ('state', ?)", [JSON.stringify(state)]); },
    async reset() { await db.exec('DELETE FROM remap_trip; DELETE FROM remap_calendar; DELETE FROM remap_exception; DELETE FROM remap_meta;'); },
    close: () => db.close(),
  };
}

/** Defer opening the persistent store until the first board needs it. */
/**
 * Defer opening the persistent store until the first board needs it. A store that cannot be
 * opened or validated is discarded with `discard` (deleting its file) and recreated once.
 */
export function lazyRemapStore(open: () => Promise<RemapStore>, discard: () => Promise<void> = async () => undefined): RemapStore {
  let opening: Promise<RemapStore> | undefined;
  const store = () => (opening ??= open().catch(async () => { await discard().catch(() => undefined); return open(); })
    .catch(error => { opening = undefined; throw error; }));
  return {
    meta: async () => (await store()).meta(),
    replace: async data => (await store()).replace(data),
    lookup: async ids => (await store()).lookup(ids),
    activeServices: async date => (await store()).activeServices(date),
    calendarRow: async serviceId => (await store()).calendarRow(serviceId),
    readState: async () => (await store()).readState(),
    writeState: async state => (await store()).writeState(state),
    async reset() {
      const current = opening; opening = undefined;
      await (await current?.catch(() => undefined))?.close?.().catch(() => undefined);
      await discard().catch(() => undefined);
    },
  };
}

export const REMAP_POLICY = { minIntervalMs: 24 * 3_600_000, manualMinIntervalMs: 10 * 60_000 } as const;
export type RemapOutcome = 'updated' | 'not-modified' | 'package-current' | 'throttled' | 'skipped-network' | 'failed' | 'unsupported';
export interface RemapReport { outcome: RemapOutcome; bytes?: number; durationMs?: number; requests?: number; error?: string }

/**
 * Keeps the remap current, at most one attempt per day (a manual refresh may retry after 10
 * minutes), only when asked by a visible board, with conditional requests straight to GTT.
 * When GTT's central directory shows the active package's members unchanged, that is a direct
 * upstream confirmation and no member is downloaded.
 */
export function createRemapService(deps: {
  store: RemapStore;
  transport?: RangeTransport;
  url: string;
  now?: () => number;
  networkAllowed?: () => Promise<boolean>;
  /** CRC-32 of the active package's source members, to recognise an unchanged export. */
  activeSourceCrc?: () => Record<string, string> | undefined;
  onUpstreamConfirmed?: (at: number) => void;
  onUpdated?: () => void;
}) {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<RemapReport> | undefined;
  let version = 0; let lastRecovery = -Infinity;
  async function run(reason: 'unknown-trips' | 'manual' | 'stale'): Promise<RemapReport> {
    const transport = deps.transport;
    if (!transport) return { outcome: 'unsupported' };
    let state: RemapState;
    try { state = await deps.store.readState(); } catch {
      // The optional remap store is unreadable: discard it; the next attempt rebuilds it.
      await deps.store.reset().catch(() => undefined);
      return { outcome: 'failed', error: 'remap store reset' };
    }
    const interval = reason === 'manual' ? REMAP_POLICY.manualMinIntervalMs : REMAP_POLICY.minIntervalMs;
    if (state.lastAttemptAt !== undefined && now() - state.lastAttemptAt < interval && now() >= state.lastAttemptAt) return { outcome: 'throttled' };
    if (deps.networkAllowed && !await deps.networkAllowed().catch(() => false)) return { outcome: 'skipped-network' };
    const started = now(); let requests = 0;
    const counted: RangeTransport = (url, headers, accept, maxBytes) => { requests++; return transport(url, headers, accept, maxBytes); };
    try {
      await deps.store.writeState({ ...state, lastAttemptAt: started });
      const meta = await deps.store.meta();
      const directory = await readCentralDirectory(counted, deps.url, meta?.etag);
      if (directory === 'not-modified') {
        await deps.store.writeState({ ...state, lastAttemptAt: started, lastCheckAt: now(), failures: 0 });
        return { outcome: 'not-modified', requests, durationMs: now() - started };
      }
      const active = deps.activeSourceCrc?.();
      const unchanged = active && ['trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt']
        .every(name => active[name] && directory.entries.get(name)?.crc32 === active[name]);
      if (unchanged) {
        // GTT's export still contains exactly the active package's trips, times and calendars.
        deps.onUpstreamConfirmed?.(now());
        await deps.store.writeState({ ...state, lastAttemptAt: started, lastCheckAt: now(), failures: 0 });
        return { outcome: 'package-current', bytes: directory.bytes, requests, durationMs: now() - started };
      }
      const { data, bytes } = await fetchRemapMembers(counted, deps.url, directory, now());
      await deps.store.replace(data);
      version++;
      await deps.store.writeState({ ...state, lastAttemptAt: started, lastCheckAt: now(), lastSuccessAt: now(), failures: 0 });
      deps.onUpdated?.();
      return { outcome: 'updated', bytes: bytes + directory.bytes, requests, durationMs: now() - started };
    } catch (error) {
      const stored = await deps.store.writeState({ ...state, lastAttemptAt: started, failures: Math.min(20, state.failures + 1) }).then(() => true, () => false);
      // A storage failure (not a network or archive problem) discards the damaged remap.
      if (!stored || !(error instanceof ZipRangeError)) await deps.store.reset().catch(() => undefined);
      return { outcome: 'failed', requests, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    /** Never throws; concurrent requests share one run. */
    refresh(reason: 'unknown-trips' | 'manual' | 'stale'): Promise<RemapReport> {
      inFlight ??= run(reason).catch((error): RemapReport => ({ outcome: 'failed', error: String(error) })).finally(() => { inFlight = undefined; });
      return inFlight;
    },
    /** A board found the stored remap unreadable: discard it (at most once an hour). */
    async recover(): Promise<void> {
      if (now() - lastRecovery < 3_600_000 && now() >= lastRecovery) return;
      lastRecovery = now();
      await deps.store.reset().catch(() => undefined);
    },
    version: () => version,
    store: deps.store,
  };
}
export type RemapService = ReturnType<typeof createRemapService>;
