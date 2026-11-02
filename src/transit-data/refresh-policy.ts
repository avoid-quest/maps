import type { BoardNotice } from './board-model';
import { addDays, coverageAt, romeDate } from './calendar';
import type { DatasetMeta } from './reader';

export const REFRESH_POLICY = {
  /** Opening or resuming a board checks the manifest when the last successful check is older. */
  checkIntervalMs: 6 * 3_600_000,
  /** A nonempty realtime feed with zero joins triggers one immediate check per hour at most. */
  mismatchIntervalMs: 3_600_000,
  /** Warn when no manifest has confirmed the active package for this long. */
  unconfirmedWarningMs: 48 * 3_600_000,
  backoffBaseMs: 5 * 60_000,
  backoffMaxMs: 6 * 3_600_000,
  manualMinIntervalMs: 10_000,
} as const;

export type CheckReason = 'open' | 'manual' | 'mismatch';
/** What a manifest said about one specific package; never transferred to another package. */
export interface PackageEvidence {
  /** upstream_checked_at of a manifest that announced this package (ms). */
  confirmedAt?: number;
  /** Manifest ETag per mirror base URL, obtained while this package was active. */
  validators?: Record<string, string>;
}
export interface RefreshState {
  lastCheckAt?: number;
  lastSuccessAt?: number;
  lastMismatchCheckAt?: number;
  failures: number;
  nextAllowedAt?: number;
  /** Hash announced by the most recent manifest, when it differs from the active one. */
  pendingHash?: string;
  /** A package whose verified content failed validation; not downloaded again until the manifest changes. */
  rejectedHash?: string;
  wifiOnly: boolean;
  /**
   * Opt-in: also ask GTT's per-stop endpoint for the open board (GTT then learns which stop is
   * viewed). Off by default.
   */
  stopLive: boolean;
  /** Active package that `lastSuccessAt` and the evidence lookups refer to. */
  activeHash?: string;
  /** Evidence keyed by package hash (active and previous only). */
  evidence: Record<string, PackageEvidence>;
}
export const INITIAL_REFRESH_STATE: RefreshState = { failures: 0, wifiOnly: false, stopLive: false, evidence: {} };

/** Normalize persisted state (older shapes included) without trusting unknown fields. */
export function restoreRefreshState(value: unknown): RefreshState {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<RefreshState>;
  const number = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : undefined;
  const evidence: Record<string, PackageEvidence> = {};
  for (const [hash, entry] of Object.entries(raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : {})) {
    if (!/^[0-9a-f]{64}$/.test(hash) || !entry || typeof entry !== 'object') continue;
    const validators = Object.fromEntries(Object.entries(entry.validators ?? {}).filter(([, tag]) => typeof tag === 'string'));
    evidence[hash] = { ...(number(entry.confirmedAt) !== undefined ? { confirmedAt: number(entry.confirmedAt) } : {}), ...(Object.keys(validators).length ? { validators } : {}) };
  }
  return {
    failures: Math.max(0, Math.min(20, number(raw.failures) ?? 0)), wifiOnly: raw.wifiOnly === true, stopLive: raw.stopLive === true, evidence,
    ...Object.fromEntries((['lastCheckAt', 'lastSuccessAt', 'lastMismatchCheckAt', 'nextAllowedAt'] as const).flatMap(key => number(raw[key]) !== undefined ? [[key, number(raw[key])]] : [])),
    ...Object.fromEntries((['pendingHash', 'rejectedHash', 'activeHash'] as const).flatMap(key => typeof raw[key] === 'string' ? [[key, raw[key]]] : [])),
  };
}

/**
 * Bind the state to the package that is active now. After a rollback or any switch, the previous
 * package's validators and confirmation stay with that package, and the 6 h interval restarts.
 */
export function bindActive(state: RefreshState, packageHash: string): RefreshState {
  if (state.activeHash === packageHash) return state;
  const keep = new Set([packageHash, state.activeHash]);
  const evidence = Object.fromEntries(Object.entries(state.evidence).filter(([hash]) => keep.has(hash)));
  const { lastSuccessAt: _lastSuccessAt, ...rest } = state;
  return { ...rest, activeHash: packageHash, evidence };
}
export function activeEvidence(state: RefreshState): PackageEvidence {
  return state.activeHash ? state.evidence[state.activeHash] ?? {} : {};
}
export function confirmedAt(state: RefreshState): number | undefined { return activeEvidence(state).confirmedAt; }
export function withEvidence(state: RefreshState, update: { confirmedAt?: number; validator?: { mirror: string; etag?: string } }): RefreshState {
  if (!state.activeHash) return state;
  const current = activeEvidence(state);
  const confirmed = Math.max(current.confirmedAt ?? 0, Number.isFinite(update.confirmedAt) ? update.confirmedAt! : 0) || undefined;
  const validators = { ...current.validators };
  if (update.validator) {
    if (update.validator.etag) validators[update.validator.mirror] = update.validator.etag; else delete validators[update.validator.mirror];
  }
  const next: PackageEvidence = { ...(confirmed ? { confirmedAt: confirmed } : {}), ...(Object.keys(validators).length ? { validators } : {}) };
  return { ...state, evidence: { ...state.evidence, [state.activeHash]: next } };
}

export function shouldCheck(state: RefreshState, reason: CheckReason, now: number): boolean {
  if (reason === 'manual') return state.lastCheckAt === undefined || now - state.lastCheckAt >= REFRESH_POLICY.manualMinIntervalMs || now < state.lastCheckAt;
  // A backoff further ahead than the maximum means the clock moved back: ignore it.
  if (state.nextAllowedAt !== undefined && now < state.nextAllowedAt && state.nextAllowedAt - now <= REFRESH_POLICY.backoffMaxMs) return false;
  if (reason === 'mismatch') return state.lastMismatchCheckAt === undefined || now - state.lastMismatchCheckAt >= REFRESH_POLICY.mismatchIntervalMs || now < state.lastMismatchCheckAt;
  return state.lastSuccessAt === undefined || now - state.lastSuccessAt >= REFRESH_POLICY.checkIntervalMs || now < state.lastSuccessAt;
}

export function startedCheck(state: RefreshState, reason: CheckReason, now: number): RefreshState {
  return { ...state, lastCheckAt: now, ...(reason === 'mismatch' ? { lastMismatchCheckAt: now } : {}) };
}
export function failedCheck(state: RefreshState, now: number): RefreshState {
  const failures = Math.min(state.failures + 1, 20);
  const delay = Math.min(REFRESH_POLICY.backoffMaxMs, REFRESH_POLICY.backoffBaseMs * 2 ** (failures - 1));
  return { ...state, failures, nextAllowedAt: now + delay };
}
export function succeededCheck(state: RefreshState, now: number, update: Partial<Pick<RefreshState, 'pendingHash' | 'rejectedHash'>> = {}): RefreshState {
  const { nextAllowedAt: _nextAllowedAt, ...rest } = state;
  return { ...rest, ...update, failures: 0, lastSuccessAt: now };
}

/** Schedule notices shared by every board for the active package. */
export function scheduleNotices(meta: DatasetMeta, state: RefreshState, now: number, options: { updatesConfigured?: boolean } = {}): BoardNotice[] {
  const notices: BoardNotice[] = [];
  const today = romeDate(now);
  if (coverageAt(meta, now) === 'outside') {
    notices.push({ code: 'schedule-outside-coverage', text: `Orari non disponibili per oggi: il pacchetto GTT installato copre dal ${formatDate(meta.validFrom)} al ${formatDate(meta.validTo)} e gli orari non vengono stimati oltre questo periodo.`, action: 'update-schedules' });
  } else if (addDays(today, 7) > meta.validTo) {
    notices.push({ code: 'schedule-expiring', text: `Il pacchetto orari GTT copre solo fino al ${formatDate(meta.validTo)}.`, action: 'update-schedules' });
  }
  // Without a mirror there is no manifest that could confirm the package: the provenance line already
  // shows the bundled feed version and date, so a permanent "unconfirmed" warning would only nag.
  if (options.updatesConfigured === false) return notices;
  // Only a real upstream check counts; a package prepared from a local ZIP has no confirmation.
  const confirmed = Math.max(confirmedAt(state) ?? 0, (meta.manifest.upstream_checked_at ? Date.parse(meta.manifest.upstream_checked_at) : 0) || 0);
  if (!confirmed) {
    notices.push({ code: 'schedule-unconfirmed', text: 'Ultima verifica degli orari con GTT sconosciuta: potrebbero non riflettere modifiche recenti.', action: 'update-schedules' });
  } else if (now - confirmed > REFRESH_POLICY.unconfirmedWarningMs) {
    notices.push({ code: 'schedule-unconfirmed', text: 'Orari non confermati da GTT da oltre 48 ore: potrebbero non riflettere modifiche recenti.', action: 'update-schedules' });
  }
  return notices;
}

export function formatDate(date: string): string { return `${date.slice(6)}/${date.slice(4, 6)}/${date.slice(0, 4)}`; }
