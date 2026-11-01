/**
 * GTT stop board expressed in the provider-neutral board model (src/domain/types.ts:
 * TransitBoardRow / TransitBoardSnapshot), so one board type renders GTT and other providers.
 * GTT-specific provenance lives under `gtt` on each row and at board level.
 *
 * State mapping (GTFS-RT → neutral):
 * - fresh prediction (feed and entity timestamps present, plausible, ≤2 min) → 'realtime-with-source-time'
 * - prediction older than 2 min (≤30 min) → 'unknown', time kept only as providerTimeAt with sourceUpdatedAt (explicit age)
 * - NO_DATA, no TripUpdate for the trip, metro (no GTT realtime) → 'scheduled'
 * - trip CANCELED → 'cancelled' + tripCancelled; stop SKIPPED → 'cancelled' (this stop only)
 * - realtime unavailable / not joinable / missing timestamps → 'unknown' with the timetable time
 * - an arrival-only prediction makes the row's `event` 'arrival' (scheduled and predicted arrival)
 */
import type { TransitBoardMode, TransitBoardRow, TransitBoardSnapshot } from '../domain/types';

export type GttRealtimeDetail =
  | 'fresh' | 'stale' | 'no-trip-update' | 'no-data' | 'cancelled' | 'skipped'
  | 'not-provided' // GTT publishes no realtime for this mode (metro)
  | 'unavailable' // feed not retrieved or not joinable to the installed schedule
  | 'unverifiable' // TripUpdate without usable timestamps or event values
  | 'expired' // prediction older than 30 minutes
  | 'before-first-update'; // the trip's updates start after this stop: the vehicle may have passed

export interface GttRowDetail {
  routeId: string;
  tripId: string;
  serviceDate: string;
  realtime: GttRealtimeDetail;
  /** Seconds; zero and negative allowed. Present for fresh and stale predictions. */
  delaySeconds?: number;
  /** Delay came from an earlier stop of the same trip (GTFS-RT propagation). */
  propagated?: boolean;
  /** Frequency-based service without exact times: a service level, never a fabricated time. */
  frequency?: { headwaySeconds: number; from: number; until: number };
  /** When the schedule source was last modified upstream (ms). */
  scheduleUpdatedAt?: number;
  note?: string;
}
export interface GttBoardRow extends TransitBoardRow { provider: 'gtt'; gtt: GttRowDetail }

export type BoardNoticeCode =
  | 'schedule-outside-coverage' | 'schedule-unconfirmed' | 'schedule-expiring'
  | 'realtime-unmatched' | 'realtime-unavailable' | 'realtime-feed-stale';
export interface BoardNotice { code: BoardNoticeCode; text: string; action?: 'update-schedules' }

export interface ScheduleProvenance {
  packageHash: string;
  feedVersion: string;
  validFrom: string;
  validTo: string;
  packageSource: 'bundled' | 'downloaded';
  sourceUpdatedAt?: number;
  upstreamCheckedAt?: number;
  builtAt?: number;
  coverage: 'covered' | 'outside';
}
export interface RealtimeSummary {
  state: 'ok' | 'unmatched' | 'unavailable' | 'not-requested';
  feedUpdatedAt?: number;
  retrievedAt?: number;
  tripUpdates: number;
  matchedTrips: number;
  unmatchedTrips: number;
  error?: string;
}
export interface StopBoard extends TransitBoardSnapshot {
  provider: 'gtt';
  rows: GttBoardRow[];
  generatedAt: number;
  schedule: ScheduleProvenance;
  realtime: RealtimeSummary;
  notices: BoardNotice[];
}

export const GTT_ATTRIBUTION = 'Data source: GTT S.p.A. – Gruppo Torinese Trasporti';
export const GTT_URL = 'https://www.gtt.to.it';
export const LIVE_MAX_AGE_MS = 120_000;
export const STALE_MAX_AGE_MS = 30 * 60_000;
export const LABELS = {
  scheduled: 'Programmato · GTT',
  realtime: 'Tempo reale · GTT',
  metroScheduledOnly: 'Solo orari programmati — tempo reale non disponibile',
  unmatched: 'Tempo reale non associabile agli orari disponibili',
} as const;

export function modeForRouteType(routeType: number | undefined): TransitBoardMode {
  if (routeType === undefined || routeType < 0) return 'unknown';
  if (routeType === 0 || (routeType >= 900 && routeType < 1000)) return 'tram';
  if (routeType === 1 || routeType === 401 || routeType === 402) return 'metro';
  if (routeType === 2 || (routeType >= 100 && routeType < 200)) return 'rail';
  if (routeType === 3 || (routeType >= 700 && routeType < 800)) return 'bus';
  if (routeType === 7 || routeType === 1400) return 'funicular';
  if (routeType === 4 || (routeType >= 1000 && routeType < 1100)) return 'ferry';
  if (routeType === 6 || routeType === 1300) return 'aerial-lift';
  return 'other';
}

/**
 * Render-time aging: a fresh GTT prediction becomes 'unknown' (time kept as providerTimeAt with its
 * age) after 2 minutes and is dropped after 30 minutes, without waiting for another download.
 */
export function agedRow(row: GttBoardRow, now: number): GttBoardRow {
  if (row.sourceUpdatedAt === undefined || (row.gtt.realtime !== 'fresh' && row.gtt.realtime !== 'stale')) return row;
  const age = now - row.sourceUpdatedAt;
  const time = row.predictedAt ?? row.providerTimeAt;
  if (age > STALE_MAX_AGE_MS) {
    const { predictedAt: _p, providerTimeAt: _t, sourceUpdatedAt: _s, ...rest } = row;
    const { delaySeconds: _d, propagated: _r, ...detail } = row.gtt;
    return { ...rest, realtimeState: 'unknown', timeBasis: 'scheduled', gtt: { ...detail, realtime: 'expired' } };
  }
  if (age > LIVE_MAX_AGE_MS && row.realtimeState === 'realtime-with-source-time') {
    const { predictedAt: _p, ...rest } = row;
    return { ...rest, realtimeState: 'unknown', providerTimeAt: time, gtt: { ...row.gtt, realtime: 'stale' } };
  }
  return row;
}

/** Provenance label beside a row. */
export function provenanceLabel(row: GttBoardRow): string {
  return row.gtt.realtime === 'fresh' || row.gtt.realtime === 'stale' || row.realtimeState === 'cancelled' ? LABELS.realtime : LABELS.scheduled;
}
