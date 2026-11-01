import type { TransitBoardRow, TransitRealtimeState } from './types';

/** Short Italian labels for a row's realtime state. Age labels for sourced realtime belong to the UI. */
export const REALTIME_STATE_LABELS: Record<TransitRealtimeState, string> = {
  'realtime-with-source-time': 'In tempo reale',
  'declared-realtime-no-source-time': 'Dichiarato in tempo reale · aggiornamento origine non disponibile',
  scheduled: 'Orario programmato · nessun dato in tempo reale',
  cancelled: 'Cancellata',
  unknown: 'Stato in tempo reale non determinabile',
};

export function realtimeStateLabel(row: Pick<TransitBoardRow, 'realtimeState' | 'tripCancelled' | 'timeBasis'> & Partial<Pick<TransitBoardRow, 'sourceUpdatedAt'>>): string {
  if (row.realtimeState === 'cancelled') return row.tripCancelled ? 'Corsa cancellata' : 'Fermata soppressa per questa corsa';
  // "In tempo reale" requires a real source timestamp; never let the state alone imply one.
  if (row.realtimeState === 'realtime-with-source-time' && !Number.isFinite(row.sourceUpdatedAt)) return REALTIME_STATE_LABELS['declared-realtime-no-source-time'];
  if (row.realtimeState === 'unknown' && row.timeBasis === 'inconsistent') return 'Dati in tempo reale incoerenti · orario non confermato';
  return REALTIME_STATE_LABELS[row.realtimeState];
}

/** Delay in whole minutes, only when both a realtime and a scheduled time exist. Negative means early. */
export function delayMinutes(row: Pick<TransitBoardRow, 'predictedAt' | 'scheduledAt'>): number | undefined {
  if (row.predictedAt === undefined || row.scheduledAt === undefined) return undefined;
  return Math.round((row.predictedAt - row.scheduledAt) / 60_000);
}

/** The time a board should sort and display by: realtime when present, otherwise the timetable. */
export function boardTime(row: Pick<TransitBoardRow, 'predictedAt' | 'scheduledAt' | 'providerTimeAt'>): number | undefined {
  return row.predictedAt ?? row.scheduledAt ?? row.providerTimeAt;
}
