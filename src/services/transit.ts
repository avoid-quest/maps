import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import type { Coordinate, Stop, TransitAlertSnapshot } from '../domain/types';
import { transitAlertWarnings } from '../domain/transit-alert-freshness';
import { BOARD_LIMIT, composeBoard } from '../transit-data/board';
import { GTT_STOP_ENDPOINT } from '../transit-data/config';
import { joinFeed, remapRefreshReason, type FeedJoin } from '../transit-data/identity-join';
import { REMAP_POLICY } from '../transit-data/remap';
import { parseStopLive, stopLiveRows, type StopLiveSnapshot } from '../transit-data/stop-live';
import type { StopBoard } from '../transit-data/board-model';
import { epochMs, indexFeed, type RealtimeSnapshot, type RTFeed } from '../transit-data/realtime';
import type { TimetableReader } from '../transit-data/reader';
import { remapService, timetableService } from '../transit-data/runtime';
import { adoptCatalog, catalogStop, catalogStopRoutes, catalogStops } from '../transit-data/stop-catalog';
import { distanceMeters } from './geo';
import { checkAbort, fetchResponse, requestQueue, ServiceError } from './network';
import { diagnostics } from './diagnostics';
export type { RTFeed } from '../transit-data/realtime';

const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
const GTT = 'https://percorsieorari.gtt.to.it/das_gtfsrt/';
const queue = requestQueue(1500);
/** Arrival boards poll the shared citywide feed at this cadence, only while a board is visible. */
export const ARRIVALS_REFRESH_MS = 30_000;
const SOURCE = 'GTT S.p.A. – Gruppo Torinese Trasporti';

export function getNearbyStops(center: Coordinate, options: { limit?: number; radiusMeters?: number } = {}): Stop[] {
  return catalogStops().map(stop => ({ ...stop, distanceMeters: distanceMeters(center, stop.coordinate) }))
    .filter(s => s.distanceMeters <= (options.radiusMeters ?? 1800)).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, options.limit ?? 18);
}
export function getStop(stopId: string): Stop | undefined { return catalogStop(stopId); }

interface FeedSnapshot { readonly feed: RTFeed; readonly fetchedAt: number }
const cache = new Map<string, FeedSnapshot>();
/** One citywide retrieval per interval, shared by every consumer; the selected stop is never sent. */
async function fetchFeed(file: string, maxAge: number, signal?: AbortSignal): Promise<FeedSnapshot> {
  checkAbort(signal); const stored = cache.get(file); const now = Date.now();
  if (stored && now >= stored.fetchedAt && now - stored.fetchedAt < maxAge) return stored;
  return queue(async () => {
    const current = cache.get(file); const now = Date.now();
    if (current && now >= current.fetchedAt && now - current.fetchedAt < maxAge) return current;
    const provider = file === 'trip_update.aspx' ? 'gtt-arrivals' : file === 'alerts.aspx' ? 'gtt-alerts' : 'other';
    const response = await fetchResponse(`${GTT}${file}`, { signal }, provider);
    try {
      const decoded = Feed.decode(new Uint8Array(await response.arrayBuffer()));
      checkAbort(signal);
      const feed = Feed.toObject(decoded, { longs: Number, enums: String }) as RTFeed;
      if (!feed.header?.gtfsRealtimeVersion) throw new Error('missing feed header');
      if (feed.header.incrementality === 'DIFFERENTIAL') throw new Error('unsupported differential feed');
      // Protobuf omits an empty repeated field; an empty FULL_DATASET is a valid no-predictions snapshot.
      feed.entity ??= [];
      const snapshot = Object.freeze({ feed, fetchedAt: Date.now() });
      cache.set(file, snapshot); return snapshot;
    } catch {
      checkAbort(signal);
      diagnostics.record({ type: 'service', state: 'invalid', provider });
      throw new ServiceError('GTT ha restituito un feed non valido. Nessuna previsione inventata.', 'invalid');
    }
  }, signal);
}

interface Joined { snapshot: RealtimeSnapshot; joins: Map<string, Promise<FeedJoin>> }
const joined = new WeakMap<FeedSnapshot, Joined>();
/**
 * Index the feed once and join it once per installed package and remap version: by trip_id,
 * then by schedule identity for trip IDs GTT has re-issued. Live trip IDs unknown to both start
 * one conditional, at-most-daily remap read of GTT's own export.
 */
async function realtimeFor(feed: FeedSnapshot, reader: TimetableReader): Promise<{ snapshot: RealtimeSnapshot; join: FeedJoin }> {
  let entry = joined.get(feed);
  if (!entry) joined.set(feed, entry = { snapshot: indexFeed(feed.feed, feed.fetchedAt), joins: new Map() });
  const { snapshot } = entry;
  const remapMeta = await remapService.store.meta().catch(() => undefined);
  const remapVersion = remapMeta?.fetchedAt ?? 0;
  const key = `${reader.meta.packageHash}|${remapVersion}`;
  let join = entry.joins.get(key);
  if (!join) {
    join = joinFeed(snapshot, reader, remapService.store).then(result => {
      const unmatched = snapshot.tripUpdates - result.matchedTrips;
      // Unmatched counts are diagnostics, not board content.
      if (snapshot.tripUpdates && !result.matchedTrips) diagnostics.record({ type: 'timetable', state: 'realtime-unmatched', count: unmatched });
      else if (unmatched) diagnostics.record({ type: 'timetable', state: 'realtime-partial', count: unmatched });
      if (result.identityMatched) diagnostics.record({ type: 'timetable', state: 'realtime-identity', count: result.identityMatched });
      return result;
    });
    join.catch(() => entry!.joins.delete(key));
    entry.joins.set(key, join);
  }
  const result = await join;
  // The optional remap failed: exact joins stand; discard the damaged store so it is rebuilt.
  if (result.remapFailed) void remapService.recover();
  const reason = remapRefreshReason(result, remapMeta?.fetchedAt, Date.now(), REMAP_POLICY.minIntervalMs);
  if (reason) refreshRemap(reason);
  return { snapshot, join: result };
}

/** "Aggiorna orari": manifest check plus a direct (rate-limited) check of GTT's export. */
export function updateSchedulesNow(): void {
  void timetableService.check('manual');
  refreshRemap('manual');
}

function refreshRemap(reason: 'unknown-trips' | 'manual' | 'stale') {
  void remapService.refresh(reason).then(report => {
    const state = report.outcome === 'updated' ? 'remap-updated' : report.outcome === 'not-modified' || report.outcome === 'package-current' ? 'remap-current' : report.outcome === 'failed' ? 'remap-failed' : undefined;
    if (state) diagnostics.record({ type: 'timetable', state, ...(report.bytes ? { count: Math.round(report.bytes / 1024) } : {}) });
  });
}

interface StopLiveEntry { snapshot: StopLiveSnapshot; at: number }
const stopLiveCache = new Map<string, StopLiveEntry>();
let lastStopLiveRequest = -Infinity;
const STOP_LIVE_CACHE_MS = 25_000; const STOP_LIVE_SPACING_MS = 30_000;
/**
 * Opt-in only, for the visible board: GTT's per-stop endpoint with the stop's public code (GTT
 * learns which stop is viewed). No location, no cookies, at most one request per 30 s.
 */
async function stopLiveFor(stopId: string, reader: TimetableReader, signal?: AbortSignal): Promise<StopLiveSnapshot | undefined> {
  if (!timetableService.status().refresh.stopLive) return undefined;
  const stop = await reader.stop(stopId);
  if (!stop?.code || !/^\d+$/.test(stop.code)) return undefined;
  // Urban (bus/tram) routes only: the endpoint is queried with bacino=U; metro stays scheduled.
  const [stopRoutes, routes] = await Promise.all([reader.stopRoutes(), reader.routes()]);
  if (!(stopRoutes.get(stopId) ?? []).some(routeId => { const route = routes.get(routeId); return route?.agencyId === 'U' && (route.routeType === 0 || route.routeType === 3); })) return undefined;
  const now = Date.now();
  const cached = stopLiveCache.get(stop.code);
  if (cached && now - cached.at < STOP_LIVE_CACHE_MS && now >= cached.at) return cached.snapshot;
  if (now - lastStopLiveRequest < STOP_LIVE_SPACING_MS && now >= lastStopLiveRequest) return cached?.snapshot;
  lastStopLiveRequest = now;
  const url = `${GTT_STOP_ENDPOINT}?option=com_gtt&task=palina.getTransitiOld&palina=${encodeURIComponent(stop.code)}&bacino=U&realtime=true&get_param=value`;
  try {
    const response = await fetchResponse(url, { signal, credentials: 'omit' }, 'gtt-stop');
    const snapshot = parseStopLive(JSON.parse(await response.text()), stop.code, Date.now());
    stopLiveCache.set(stop.code, { snapshot, at: snapshot.retrievedAt });
    if (stopLiveCache.size > 8) stopLiveCache.delete(stopLiveCache.keys().next().value!);
    return snapshot;
  } catch {
    checkAbort(signal);
    diagnostics.record({ type: 'service', state: 'invalid', provider: 'gtt-stop' });
    return cached?.snapshot;
  }
}

async function withStopLive(board: StopBoard, reader: TimetableReader, signal?: AbortSignal): Promise<StopBoard> {
  const snapshot = await stopLiveFor(board.stop.id, reader, signal);
  if (!snapshot) return board;
  const [routes, agencies] = await Promise.all([reader.routes(), reader.agencies()]);
  const now = Date.now();
  const extra = stopLiveRows(snapshot, board, { now, routes, operator: agencyId => agencies.get(agencyId) });
  if (!extra.length) return board;
  const time = (row: StopBoard['rows'][number]) => row.predictedAt ?? row.providerTimeAt ?? row.scheduledAt ?? row.gtt.frequency?.from ?? now;
  return { ...board, rows: [...board.rows, ...extra].sort((a, b) => time(a) - time(b)).slice(0, BOARD_LIMIT + extra.length) };
}

async function activeReader(stopId: string): Promise<TimetableReader> {
  let dataset;
  try { dataset = await timetableService.current(); } catch { throw new ServiceError('Orari GTT non disponibili sul dispositivo.', 'unavailable'); }
  void adoptCatalog(dataset.reader).catch(() => undefined);
  if (!stopId || !await dataset.reader.stop(stopId)) throw new ServiceError('Fermata non presente nel pacchetto orari installato.', 'invalid');
  return dataset.reader;
}

/** Realtime failed: the error carries the scheduled board so the UI keeps rows while the refresh backs off. */
export class RealtimeUnavailableError extends ServiceError {
  constructor(message: string, readonly board: StopBoard, kind: ServiceError['kind']) { super(message, kind); this.name = 'RealtimeUnavailableError'; }
}

/** Local scheduled rows only: no network, rendered immediately. */
export async function getScheduledBoard(stopId: string, options: { signal?: AbortSignal; now?: number } = {}): Promise<StopBoard> {
  const reader = await activeReader(stopId);
  checkAbort(options.signal);
  return composeBoard(reader, stopId, options.now ?? Date.now(), { refresh: timetableService.status().refresh });
}

/** Scheduled rows refined by the shared citywide TripUpdates feed. */
export async function getStopBoard(stopId: string, options: { signal?: AbortSignal } = {}): Promise<StopBoard> {
  const reader = await activeReader(stopId);
  let feed: FeedSnapshot;
  try { feed = await fetchFeed('trip_update.aspx', ARRIVALS_REFRESH_MS - 5_000, options.signal); } catch (error) {
    checkAbort(options.signal);
    const message = error instanceof Error ? error.message : 'Tempo reale non disponibile.';
    // The opt-in per-stop source still works when the citywide feed host is down.
    const board = await withStopLive(await composeBoard(reader, stopId, Date.now(), { refresh: timetableService.status().refresh, realtime: { error: message } }), reader, options.signal);
    throw new RealtimeUnavailableError(message, board, error instanceof ServiceError ? error.kind : 'network');
  }
  checkAbort(options.signal);
  const realtime = await realtimeFor(feed, reader);
  const board = await withStopLive(await composeBoard(reader, stopId, Date.now(), { refresh: timetableService.status().refresh, realtime, nextRefreshAt: feed.fetchedAt + ARRIVALS_REFRESH_MS }), reader, options.signal);
  // A nonempty feed with zero joins means the installed package is older than GTT's trip IDs.
  if (board.realtime.state === 'unmatched') void timetableService.check('mismatch');
  return board;
}

function text(value?: { translation?: { text?: string; language?: string }[] }): string { return value?.translation?.find(t => t.language === 'it')?.text ?? value?.translation?.[0]?.text ?? ''; }
export async function getTransitAlerts(stopId?: string, options: { signal?: AbortSignal } = {}): Promise<TransitAlertSnapshot> {
  const stop = stopId === undefined ? undefined : getStop(stopId);
  if (stopId !== undefined && !stop) throw new ServiceError('Fermata non presente nel pacchetto installato.', 'invalid');
  const { feed, fetchedAt } = await fetchFeed('alerts.aspx', 5 * 60_000, options.signal); const now = Date.now();
  checkAbort(options.signal);
  const sourceUpdatedAt = epochMs(feed.header?.timestamp);
  const warnings = transitAlertWarnings(sourceUpdatedAt, now);
  const routeIds = stopId ? new Set(catalogStopRoutes(stopId)) : undefined;
  const alerts = (feed.entity ?? []).flatMap(entity => {
    const alert = entity.alert; if (!alert || entity.isDeleted) return [];
    if (alert.activePeriod?.length && !alert.activePeriod.some(p => (!epochMs(p.start) || epochMs(p.start)! <= now) && (!epochMs(p.end) || epochMs(p.end)! >= now))) return [];
    if (stopId && alert.informedEntity?.length && !alert.informedEntity.some(e => e.stopId === stopId || (!e.stopId && (!e.routeId || routeIds?.has(e.routeId))))) return [];
    return [{ id: entity.id ?? text(alert.headerText), title: text(alert.headerText), description: text(alert.descriptionText), url: text(alert.url) || undefined, source: SOURCE }];
  }).slice(0, 30);
  return { alerts, fetchedAt, sourceUpdatedAt, source: SOURCE, warnings };
}
