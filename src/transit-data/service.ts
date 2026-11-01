import { PackageError, validateManifest } from './package-format';
import type { ActiveDataset, PackageStore } from './package-store';
import type { DatasetMeta } from './reader';
import { failedCheck, INITIAL_REFRESH_STATE, shouldCheck, startedCheck, succeededCheck, type CheckReason, type RefreshState } from './refresh-policy';

/**
 * Published by .github/workflows/gtt-timetable.yml. A plain GET with an optional If-None-Match
 * validator: no device identifier, stop, location or query parameter is ever sent.
 */
export const MANIFEST_URL = 'https://avoid-quest.github.io/maps/gtt/manifest.json';

export type CheckOutcome = 'current' | 'installed' | 'not-modified' | 'outdated-manifest' | 'rejected' | 'failed' | 'skipped-network' | 'throttled';
export interface ScheduleStatus {
  phase: 'preparing' | 'ready' | 'failed';
  meta?: DatasetMeta;
  refresh: RefreshState;
  checking: boolean;
  lastOutcome?: CheckOutcome;
  lastError?: string;
  updateSupported: boolean;
}
export interface TimetableService {
  ready(): Promise<ActiveDataset>;
  /** The dataset active now (after any switch since ready()). */
  current(): Promise<ActiveDataset>;
  status(): ScheduleStatus;
  subscribe(listener: () => void): () => void;
  /** Never throws; the outcome is also reflected in status(). */
  check(reason: CheckReason): Promise<CheckOutcome>;
  setWifiOnly(value: boolean): Promise<void>;
}

export interface TimetableEvents { record(event: 'installed' | 'current' | 'failed' | 'rejected' | 'rolled-back'): void }

export function createTimetableService(deps: {
  store: PackageStore;
  fetch: typeof fetch;
  manifestUrl?: string;
  /** Resolves false when the user's network preference forbids a schedule download now. */
  networkAllowed?: (wifiOnly: boolean) => Promise<boolean>;
  now?: () => number;
  events?: TimetableEvents;
}): TimetableService {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const manifestUrl = deps.manifestUrl ?? MANIFEST_URL;
  const listeners = new Set<() => void>();
  let status: ScheduleStatus = { phase: 'preparing', refresh: INITIAL_REFRESH_STATE, checking: false, updateSupported: true };
  let opening: Promise<ActiveDataset> | undefined;
  let inFlight: Promise<CheckOutcome> | undefined;
  const update = (next: Partial<ScheduleStatus>) => {
    status = { ...status, ...next };
    for (const listener of listeners) { try { listener(); } catch { /* observers cannot break data access */ } }
  };

  function ready() {
    opening ??= (async () => {
      try {
        const dataset = await store.open();
        update({ phase: 'ready', meta: dataset.meta, refresh: await store.readState() });
        return dataset;
      } catch (error) {
        opening = undefined;
        update({ phase: 'failed', lastError: error instanceof Error ? error.message : 'Orari non disponibili.' });
        throw error;
      }
    })();
    return opening;
  }

  async function save(refresh: RefreshState, extra: Partial<ScheduleStatus> = {}) {
    update({ refresh, ...extra });
    await store.writeState(refresh).catch(() => undefined);
  }

  async function run(reason: CheckReason): Promise<CheckOutcome> {
    const dataset = await ready();
    let state = status.refresh;
    if (!shouldCheck(state, reason, now())) return 'throttled';
    if (deps.networkAllowed && !await deps.networkAllowed(state.wifiOnly).catch(() => true)) {
      update({ lastOutcome: 'skipped-network' }); return 'skipped-network';
    }
    state = startedCheck(state, reason, now());
    update({ checking: true, refresh: state });
    let manifestHash: string | undefined; let etag: string | undefined;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        response = await deps.fetch(manifestUrl, { signal: controller.signal, ...(state.manifestEtag ? { headers: { 'If-None-Match': state.manifestEtag } } : {}) });
      } finally { clearTimeout(timer); }
      if (response.status === 304) {
        await save(succeededCheck(state, now()), { checking: false, lastOutcome: 'not-modified', lastError: undefined });
        return 'not-modified';
      }
      if (!response.ok) throw new PackageError(`Manifest orari non disponibile (HTTP ${response.status}).`, 'network');
      const manifest = validateManifest(await response.json());
      manifestHash = manifest.package_hash; etag = response.headers.get('ETag') ?? undefined;
      const current = store.active()?.meta ?? dataset.meta;
      if (manifest.package_hash === current.packageHash) {
        await save(succeededCheck(state, now(), { confirmedAt: Date.parse(manifest.upstream_checked_at), manifestEtag: etag, pendingHash: undefined }), { checking: false, lastOutcome: 'current', lastError: undefined });
        deps.events?.record('current');
        return 'current';
      }
      // A cached or older manifest must never downgrade the active package.
      if (Date.parse(manifest.built_at) <= Date.parse(current.manifest.built_at)) {
        await save(succeededCheck(state, now(), { manifestEtag: etag }), { checking: false, lastOutcome: 'outdated-manifest', lastError: undefined });
        return 'outdated-manifest';
      }
      if (manifest.package_hash === state.rejectedHash) throw new PackageError('Il pacchetto orari pubblicato è già stato rifiutato.', 'invalid');
      // package_path is validated as packages/gtt-<sha256>.json, relative to the manifest directory.
      const installed = await store.installDownloaded(manifest, manifestUrl.replace(/[^/]*$/, '') + manifest.package_path);
      await save(succeededCheck({ ...state, confirmedAt: undefined }, now(), { confirmedAt: Date.parse(manifest.upstream_checked_at), manifestEtag: etag, pendingHash: undefined, rejectedHash: undefined }),
        { checking: false, lastOutcome: 'installed', lastError: undefined, meta: installed.meta });
      deps.events?.record('installed');
      return 'installed';
    } catch (error) {
      const rejected = error instanceof PackageError && (error.kind === 'hash' || error.kind === 'invalid') && manifestHash !== undefined;
      let next = failedCheck(state, now());
      // Remember a verifiably bad package so it is not downloaded again; transient failures keep no validator.
      if (rejected) next = { ...next, rejectedHash: manifestHash, manifestEtag: etag, pendingHash: manifestHash };
      else if (manifestHash) next = { ...next, pendingHash: manifestHash };
      await save(next, { checking: false, lastOutcome: rejected ? 'rejected' : 'failed', lastError: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Connessione non disponibile.' });
      deps.events?.record(rejected ? 'rejected' : 'failed');
      return rejected ? 'rejected' : 'failed';
    }
  }

  return {
    ready,
    current: async () => { const opened = await ready(); return store.active() ?? opened; },
    status: () => status,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check(reason) {
      if (inFlight) return inFlight;
      inFlight = run(reason).catch((): CheckOutcome => 'failed').finally(() => { inFlight = undefined; });
      return inFlight;
    },
    async setWifiOnly(value) { await ready().catch(() => undefined); await save({ ...status.refresh, wifiOnly: value }); },
  };
}

/** Web and tests: the bundled package only, no downloads. */
export function createStaticTimetableService(open: () => Promise<ActiveDataset>): TimetableService {
  let status: ScheduleStatus = { phase: 'preparing', refresh: INITIAL_REFRESH_STATE, checking: false, updateSupported: false };
  const listeners = new Set<() => void>();
  let opening: Promise<ActiveDataset> | undefined;
  const ready = () => {
    opening ??= open().then(dataset => {
      status = { ...status, phase: 'ready', meta: dataset.meta, refresh: { ...status.refresh, confirmedAt: Date.parse(dataset.meta.manifest.upstream_checked_at) } };
      listeners.forEach(listener => listener());
      return dataset;
    });
    return opening;
  };
  return {
    ready,
    current: ready,
    status: () => status,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async check() { return 'skipped-network'; },
    async setWifiOnly(value) { status = { ...status, refresh: { ...status.refresh, wifiOnly: value } }; listeners.forEach(listener => listener()); },
  };
}
