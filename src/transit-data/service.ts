import { TIMETABLE_MIRRORS } from './config';
import { isUpgrade, PackageError, validateManifest, type PackageManifest } from './package-format';
import type { ActiveDataset, PackageStore } from './package-store';
import type { DatasetMeta } from './reader';
import {
  activeEvidence, bindActive, failedCheck, INITIAL_REFRESH_STATE, shouldCheck, startedCheck, succeededCheck, withEvidence,
  type CheckReason, type RefreshState,
} from './refresh-policy';

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

const MANIFEST = 'manifest.json';

export function createTimetableService(deps: {
  store: PackageStore;
  fetch: typeof fetch;
  /** Ordered mirror base URLs; defaults to the single configured list. */
  mirrors?: readonly string[];
  /**
   * Resolves whether a schedule download is allowed now under the user's preference. When it
   * cannot be established (the lookup throws) a Wi-Fi-only preference defers the update.
   */
  networkAllowed?: (wifiOnly: boolean) => Promise<boolean>;
  now?: () => number;
  events?: TimetableEvents;
}): TimetableService {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const mirrors = (deps.mirrors ?? TIMETABLE_MIRRORS).map(base => base.endsWith('/') ? base : `${base}/`);
  const listeners = new Set<() => void>();
  let status: ScheduleStatus = { phase: 'preparing', refresh: INITIAL_REFRESH_STATE, checking: false, updateSupported: mirrors.length > 0 };
  let opening: Promise<ActiveDataset> | undefined;
  let inFlight: Promise<CheckOutcome> | undefined;
  const update = (next: Partial<ScheduleStatus>) => {
    status = { ...status, ...next };
    for (const listener of listeners) { try { listener(); } catch { /* observers cannot break data access */ } }
  };
  async function save(refresh: RefreshState, extra: Partial<ScheduleStatus> = {}) {
    update({ refresh, ...extra });
    await store.writeState(refresh).catch(() => undefined);
  }
  const activeMeta = (fallback: DatasetMeta) => store.active()?.meta ?? fallback;

  function ready() {
    opening ??= (async () => {
      try {
        const dataset = await store.open();
        // Evidence (validators, confirmation) belongs to the package it was obtained for.
        const refresh = bindActive(await store.readState(), dataset.meta.packageHash);
        await save(refresh, { phase: 'ready', meta: dataset.meta });
        return dataset;
      } catch (error) {
        opening = undefined;
        update({ phase: 'failed', lastError: error instanceof Error ? error.message : 'Orari non disponibili.' });
        throw error;
      }
    })();
    return opening;
  }

  async function fetchManifest(state: RefreshState): Promise<{ mirror: string; response: Response }> {
    let lastError: unknown;
    for (const mirror of mirrors) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const etag = activeEvidence(state).validators?.[mirror];
        // Plain GET: only a cache validator, never identifiers, stop, location or query parameters.
        const response = await deps.fetch(mirror + MANIFEST, { signal: controller.signal, ...(etag ? { headers: { 'If-None-Match': etag } } : {}) });
        if (response.status === 304 || response.ok) return { mirror, response };
        lastError = new PackageError(`Manifest orari non disponibile (HTTP ${response.status}).`, 'network');
      } catch (error) { lastError = error; } finally { clearTimeout(timer); }
    }
    throw lastError ?? new PackageError('Nessun server orari configurato.', 'network');
  }

  async function run(reason: CheckReason): Promise<CheckOutcome> {
    const dataset = await ready();
    let state = bindActive(status.refresh, activeMeta(dataset.meta).packageHash);
    if (!shouldCheck(state, reason, now())) return 'throttled';
    if (deps.networkAllowed) {
      const allowed = await deps.networkAllowed(state.wifiOnly).catch(() => !state.wifiOnly);
      if (!allowed) { update({ lastOutcome: 'skipped-network' }); return 'skipped-network'; }
    }
    state = startedCheck(state, reason, now());
    update({ checking: true, refresh: state });
    let manifest: PackageManifest | undefined; let etag: string | undefined; let mirror: string | undefined;
    try {
      const fetched = await fetchManifest(state);
      mirror = fetched.mirror;
      if (fetched.response.status === 304) {
        await save(succeededCheck(state, now()), { checking: false, lastOutcome: 'not-modified', lastError: undefined });
        return 'not-modified';
      }
      manifest = validateManifest(await fetched.response.json());
      etag = fetched.response.headers.get('ETag') ?? undefined;
      const current = activeMeta(dataset.meta);
      const validator = { mirror, etag };
      if (manifest.package_hash === current.packageHash) {
        const confirmed = manifest.upstream_checked_at ? Date.parse(manifest.upstream_checked_at) : undefined;
        await save(withEvidence(succeededCheck(state, now(), { pendingHash: undefined }), { confirmedAt: confirmed, validator }), { checking: false, lastOutcome: 'current', lastError: undefined });
        deps.events?.record('current');
        return 'current';
      }
      // An older GTT source must never replace a newer one, whatever its build time.
      if (!isUpgrade(manifest, current.manifest)) {
        await save(withEvidence(succeededCheck(state, now()), { validator }), { checking: false, lastOutcome: 'outdated-manifest', lastError: undefined });
        return 'outdated-manifest';
      }
      if (manifest.package_hash === state.rejectedHash) throw new PackageError('Il pacchetto orari pubblicato è già stato rifiutato.', 'invalid');
      // package_path is validated as packages/gtt-<sha256>.json; the serving mirror first, then the others.
      const urls = [mirror, ...mirrors.filter(other => other !== mirror)].map(base => base + manifest!.package_path);
      const installed = await store.installDownloaded(manifest, urls);
      const confirmed = manifest.upstream_checked_at ? Date.parse(manifest.upstream_checked_at) : undefined;
      const next = withEvidence(bindActive(succeededCheck(state, now(), { pendingHash: undefined, rejectedHash: undefined }), installed.meta.packageHash), { confirmedAt: confirmed, validator });
      await save({ ...next, lastSuccessAt: now() }, { checking: false, lastOutcome: 'installed', lastError: undefined, meta: installed.meta });
      deps.events?.record('installed');
      return 'installed';
    } catch (error) {
      // Verified bytes with invalid content are a bad package; a hash mismatch is a bad transfer or mirror.
      const rejected = error instanceof PackageError && error.kind === 'invalid' && manifest !== undefined;
      let next = failedCheck(state, now());
      if (rejected) next = withEvidence({ ...next, rejectedHash: manifest!.package_hash, pendingHash: manifest!.package_hash }, { validator: { mirror: mirror!, etag } });
      else if (manifest) next = { ...next, pendingHash: manifest.package_hash };
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
      status = { ...status, phase: 'ready', meta: dataset.meta, refresh: bindActive(status.refresh, dataset.meta.packageHash) };
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
