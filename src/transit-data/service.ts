import { manifestUrl, packageUrl, TIMETABLE_MIRRORS, type TimetableMirror } from './config';
import { isUpgrade, PackageError, validateManifest, type PackageManifest } from './package-format';
import type { ActiveDataset, PackageStore } from './package-store';
import type { DatasetMeta } from './reader';
import {
  activeEvidence, bindActive, failedCheck, INITIAL_REFRESH_STATE, shouldCheck, startedCheck, succeededCheck, withEvidence,
  type CheckReason, type RefreshState,
} from './refresh-policy';

export type CheckOutcome = 'unsupported' | 'current' | 'installed' | 'not-modified' | 'outdated-manifest' | 'rejected' | 'failed' | 'skipped-network' | 'throttled';
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
  /** Opt-in per-stop GTT endpoint (off by default). */
  setStopLive(value: boolean): Promise<void>;
  /** Whether a schedule-data download (manifest, package, GTT remap) is allowed now. */
  updatesAllowed(): Promise<boolean>;
  /** A direct check of GTT's export showed the active package's members unchanged. */
  recordUpstreamConfirmation(at: number): Promise<void>;
}

export interface TimetableEvents { record(event: 'installed' | 'current' | 'failed' | 'rejected' | 'rolled-back'): void }


export function createTimetableService(deps: {
  store: PackageStore;
  fetch: typeof fetch;
  /** Ordered mirrors; defaults to the single configured list. */
  mirrors?: readonly TimetableMirror[];
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
  const mirrors = (deps.mirrors ?? TIMETABLE_MIRRORS).map(mirror => ({ ...mirror, base: mirror.base.endsWith('/') ? mirror.base : `${mirror.base}/` }));
  const listeners = new Set<() => void>();
  let status: ScheduleStatus = { phase: 'preparing', refresh: INITIAL_REFRESH_STATE, checking: false, updateSupported: mirrors.length > 0 };
  let opening: Promise<ActiveDataset> | undefined;
  let inFlight: Promise<CheckOutcome> | undefined;
  const update = (next: Partial<ScheduleStatus>) => {
    status = { ...status, ...next };
    for (const listener of listeners) { try { listener(); } catch { /* observers cannot break data access */ } }
  };
  type Preferences = Pick<RefreshState, 'wifiOnly' | 'stopLive'>;
  /**
   * Commit refresh bookkeeping. User preferences are never taken from a state captured before an
   * await: they are merged from the current status at commit time, so a check that completes
   * after the user changed a preference cannot restore the old value. Only the preference
   * setters pass new values.
   */
  async function save(refresh: RefreshState, extra: Partial<ScheduleStatus> = {}, preferences: Partial<Preferences> = {}) {
    const committed: RefreshState = { ...refresh, wifiOnly: status.refresh.wifiOnly, stopLive: status.refresh.stopLive, ...preferences };
    update({ refresh: committed, ...extra });
    // A preference that could not be persisted would silently revert on restart: say so.
    await store.writeState(committed).catch(() => update({ lastError: 'Impossibile salvare le impostazioni degli orari sul dispositivo.' }));
  }
  /**
   * Without an opened dataset the persisted state was never read: writing now would replace it
   * (the other preference and package evidence) with defaults. Apply in memory and say so.
   */
  async function setPreference(preference: Partial<Preferences>) {
    if (await ready().then(() => true, () => false)) return save(status.refresh, {}, preference);
    update({ refresh: { ...status.refresh, ...preference }, lastError: 'Impossibile salvare le impostazioni degli orari sul dispositivo.' });
  }
  const activeMeta = (fallback: DatasetMeta) => store.active()?.meta ?? fallback;

  function ready() {
    opening ??= (async () => {
      try {
        const dataset = await store.open();
        if (store.rolledBack()) deps.events?.record('rolled-back');
        // Evidence (validators, confirmation) belongs to the package it was obtained for.
        const refresh = bindActive(await store.readState(), dataset.meta.packageHash);
        // The persisted preferences are the source at startup.
        await save(refresh, { phase: 'ready', meta: dataset.meta }, { wifiOnly: refresh.wifiOnly, stopLive: refresh.stopLive });
        return dataset;
      } catch (error) {
        opening = undefined;
        update({ phase: 'failed', lastError: error instanceof Error ? error.message : 'Orari non disponibili.' });
        throw error;
      }
    })();
    return opening;
  }

  /** One deadline covers headers and body: a mirror stalling mid-body cannot block later checks. */
  async function fetchManifest(state: RefreshState): Promise<{ mirror: TimetableMirror; status: number; etag?: string; body?: unknown }> {
    let lastError: unknown;
    for (const mirror of mirrors) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PackageError('Il server orari non ha risposto in tempo.', 'network')); }, 20_000); });
      try {
        const etag = activeEvidence(state).validators?.[mirror.base];
        // Plain GET: only a cache validator, never identifiers, stop, location or query parameters.
        const result = await Promise.race([deadline, (async () => {
          const response = await deps.fetch(manifestUrl(mirror), { signal: controller.signal, credentials: 'omit', ...(etag ? { headers: { 'If-None-Match': etag } } : {}) });
          if (response.status === 304) return { mirror, status: 304 };
          if (!response.ok) throw new PackageError(`Manifest orari non disponibile (HTTP ${response.status}).`, 'network');
          return { mirror, status: response.status, etag: response.headers.get('ETag') ?? undefined, body: await response.json() as unknown };
        })()]);
        return result;
      } catch (error) { lastError = error; } finally { clearTimeout(timer); }
    }
    throw lastError ?? new PackageError('Nessun server orari configurato.', 'network');
  }

  async function run(reason: CheckReason): Promise<CheckOutcome> {
    const dataset = await ready();
    let state = bindActive(status.refresh, activeMeta(dataset.meta).packageHash);
    // No mirror configured: nothing to check, and no failure, backoff or error to report.
    if (!mirrors.length) { update({ lastOutcome: 'unsupported' }); return 'unsupported'; }
    if (!shouldCheck(state, reason, now())) { update({ lastOutcome: 'throttled' }); return 'throttled'; }
    if (deps.networkAllowed) {
      const allowed = await deps.networkAllowed(state.wifiOnly).catch(() => !state.wifiOnly);
      if (!allowed) { update({ lastOutcome: 'skipped-network' }); return 'skipped-network'; }
    }
    // Preferences may have changed during the network-type await: never revert them in memory.
    state = startedCheck({ ...state, wifiOnly: status.refresh.wifiOnly, stopLive: status.refresh.stopLive }, reason, now());
    update({ checking: true, refresh: state });
    let manifest: PackageManifest | undefined; let etag: string | undefined; let mirror: TimetableMirror | undefined;
    try {
      const fetched = await fetchManifest(state);
      mirror = fetched.mirror;
      if (fetched.status === 304) {
        await save(succeededCheck(state, now()), { checking: false, lastOutcome: 'not-modified', lastError: undefined });
        return 'not-modified';
      }
      manifest = validateManifest(fetched.body);
      etag = fetched.etag;
      const current = activeMeta(dataset.meta);
      const validator = { mirror: mirror.base, etag };
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
      const urls = [mirror, ...mirrors.filter(other => other.base !== mirror!.base)].map(entry => packageUrl(entry, manifest!.package_path));
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
      if (rejected) next = withEvidence({ ...next, rejectedHash: manifest!.package_hash, pendingHash: manifest!.package_hash }, { validator: { mirror: mirror!.base, etag } });
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
      inFlight = run(reason).catch((): CheckOutcome => { update({ checking: false, lastOutcome: 'failed' }); return 'failed'; }).finally(() => { inFlight = undefined; });
      return inFlight;
    },
    async setWifiOnly(value) { await setPreference({ wifiOnly: value }); },
    async setStopLive(value) { await setPreference({ stopLive: value }); },
    async updatesAllowed() {
      await ready().catch(() => undefined);
      const wifiOnly = status.refresh.wifiOnly;
      return deps.networkAllowed ? deps.networkAllowed(wifiOnly).catch(() => !wifiOnly) : true;
    },
    async recordUpstreamConfirmation(at) {
      const dataset = await ready().catch(() => undefined);
      if (!dataset) return;
      await save(withEvidence(bindActive(status.refresh, activeMeta(dataset.meta).packageHash), { confirmedAt: at }));
    },
  };
}

/** Web and tests: the bundled package only, no downloads. */
export function createStaticTimetableService(open: () => Promise<ActiveDataset>): TimetableService {
  let status: ScheduleStatus = { phase: 'preparing', refresh: INITIAL_REFRESH_STATE, checking: false, updateSupported: false };
  const listeners = new Set<() => void>();
  let opening: Promise<ActiveDataset> | undefined;
  const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* observers cannot break data access */ } });
  const ready = () => {
    opening ??= open().then(dataset => {
      status = { ...status, phase: 'ready', meta: dataset.meta, refresh: bindActive(status.refresh, dataset.meta.packageHash) };
      notify();
      return dataset;
    }, (error: unknown) => {
      // Report and allow a retry, like the downloading service.
      opening = undefined;
      status = { ...status, phase: 'failed', lastError: error instanceof Error ? error.message : 'Orari non disponibili.' };
      notify();
      throw error;
    });
    return opening;
  };
  return {
    ready,
    current: ready,
    status: () => status,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async check() { status = { ...status, lastOutcome: 'skipped-network' }; notify(); return 'skipped-network'; },
    async setWifiOnly(value) { status = { ...status, refresh: { ...status.refresh, wifiOnly: value } }; listeners.forEach(listener => listener()); },
    async setStopLive(value) { status = { ...status, refresh: { ...status.refresh, stopLive: value } }; listeners.forEach(listener => listener()); },
    async updatesAllowed() { return false; },
    async recordUpstreamConfirmation(at) {
      const dataset = await ready();
      status = { ...status, refresh: withEvidence(bindActive(status.refresh, dataset.meta.packageHash), { confirmedAt: at }) };
      listeners.forEach(listener => listener());
    },
  };
}
