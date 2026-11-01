import type { BoardNotice } from './board-model';
import { addDays, romeDate } from './calendar';
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
export interface RefreshState {
  lastCheckAt?: number;
  lastSuccessAt?: number;
  lastMismatchCheckAt?: number;
  failures: number;
  nextAllowedAt?: number;
  /** ETag of the last manifest response, for a conditional request. */
  manifestEtag?: string;
  /** Latest upstream_checked_at of a manifest that announced the active package (ms). */
  confirmedAt?: number;
  /** Hash announced by the most recent manifest, when it differs from the active one. */
  pendingHash?: string;
  /** A package hash that failed verification; not downloaded again until the manifest changes. */
  rejectedHash?: string;
  wifiOnly: boolean;
}
export const INITIAL_REFRESH_STATE: RefreshState = { failures: 0, wifiOnly: false };

export function shouldCheck(state: RefreshState, reason: CheckReason, now: number): boolean {
  if (reason === 'manual') return state.lastCheckAt === undefined || now - state.lastCheckAt >= REFRESH_POLICY.manualMinIntervalMs || now < state.lastCheckAt;
  if (state.nextAllowedAt !== undefined && now < state.nextAllowedAt) return false;
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
export function succeededCheck(state: RefreshState, now: number, update: Partial<Pick<RefreshState, 'confirmedAt' | 'manifestEtag' | 'pendingHash' | 'rejectedHash'>> = {}): RefreshState {
  const confirmedAt = Math.max(state.confirmedAt ?? 0, update.confirmedAt ?? 0) || undefined;
  return { ...state, ...update, confirmedAt, failures: 0, nextAllowedAt: undefined, lastSuccessAt: now };
}

/** Schedule notices shared by every board for the active package. */
export function scheduleNotices(meta: DatasetMeta, state: RefreshState, now: number): BoardNotice[] {
  const notices: BoardNotice[] = [];
  const today = romeDate(now);
  if (today < meta.validFrom || today > meta.validTo) {
    notices.push({ code: 'schedule-outside-coverage', text: `Orari non disponibili per oggi: il pacchetto GTT installato copre dal ${formatDate(meta.validFrom)} al ${formatDate(meta.validTo)} e gli orari non vengono stimati oltre questo periodo.`, action: 'update-schedules' });
  } else if (addDays(today, 7) > meta.validTo) {
    notices.push({ code: 'schedule-expiring', text: `Il pacchetto orari GTT copre solo fino al ${formatDate(meta.validTo)}.`, action: 'update-schedules' });
  }
  const confirmedAt = Math.max(state.confirmedAt ?? 0, Date.parse(meta.manifest.upstream_checked_at) || 0);
  if (!confirmedAt || now - confirmedAt > REFRESH_POLICY.unconfirmedWarningMs) {
    notices.push({ code: 'schedule-unconfirmed', text: 'Orari non confermati da GTT da oltre 48 ore: potrebbero non riflettere modifiche recenti.', action: 'update-schedules' });
  }
  return notices;
}

export function formatDate(date: string): string { return `${date.slice(6)}/${date.slice(4, 6)}/${date.slice(0, 4)}`; }
