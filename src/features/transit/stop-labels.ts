import type { Stop } from '../../domain/types';
import { LABELS } from '../../transit-data/board-model';
import { transitModeFromLineName } from '../../ui/transit-line';

/** A stop served only by the metro: GTT publishes no metro realtime, so its board is timetable-only. */
export function metroOnlyStop(stop: Pick<Stop, 'lines'>): boolean {
  return stop.lines.length > 0 && stop.lines.every(line => transitModeFromLineName(line) === 'metro');
}

/** Trasporti row subtitle: public code, lines, and the metro's missing realtime in words. */
export function nearbyStopSubtitle(stop: Pick<Stop, 'code' | 'lines'>): string {
  const lines = stop.lines.slice(0, 6).join(', ') || 'GTT';
  return `Fermata ${stop.code} · ${lines}${metroOnlyStop(stop) ? ` · ${LABELS.metroScheduledOnly}` : ''}`;
}
