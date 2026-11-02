import { delayMinutes, realtimeStateLabel } from '../../domain/transit-board';
import type { TransitBoardMode, TransitBoardRow } from '../../domain/types';
import type { StopBoard } from '../../transit-data/board-model';
import type { TransitMode } from '../../ui/transit-line';
import { journeyTime } from '../planner/journey-presentation';

/**
 * Rows from an online provider other than the GTT feed (Transitous). They are rendered on their own
 * board and never merged with GTT rows. Transitous publishes no source timestamp, so a realtime row
 * is "declared" and never shown in the live colour.
 */
export type ProviderTone = 'declared' | 'scheduled' | 'caution' | 'disruption';
export interface ProviderRowView {
  id: string;
  line: string;
  mode?: TransitMode;
  headsign: string;
  /** The time to read: declared realtime when present, else the timetable. */
  time: string;
  /** Timetable time beside a declared realtime time that differs by a minute or more. */
  scheduled?: string;
  status: string;
  tone: ProviderTone;
  platform?: string;
  /** Upstream operator, kept for provenance. */
  operator?: string;
  accessibilityLabel: string;
}

export function boardModeBadge(mode: TransitBoardMode): TransitMode | undefined {
  if (mode.startsWith('rail')) return 'rail';
  if (mode === 'bus' || mode === 'coach') return 'bus';
  if (mode === 'tram') return 'tram';
  if (mode === 'metro') return 'metro';
  return undefined;
}

function platformText(row: TransitBoardRow): string | undefined {
  const platform = row.platform;
  if (!platform?.current && !platform?.scheduled) return undefined;
  if (platform.changed) return `Binario ${platform.current} · cambiato da ${platform.scheduled}`;
  // A track without a separate timetable track is shown as published, not as a confirmed change.
  return `Binario ${platform.current ?? platform.scheduled}`;
}

export function providerRowView(row: TransitBoardRow): ProviderRowView {
  const line = row.displayName ?? [row.line, row.tripNumber].filter(Boolean).join(' ');
  const headsign = row.headsign ?? row.destination ?? 'Destinazione non indicata';
  const event = row.event === 'arrival' ? 'Arrivo' : 'Partenza';
  let time: string;
  let scheduled: string | undefined;
  let status: string;
  let tone: ProviderTone;
  switch (row.realtimeState) {
    case 'cancelled':
      time = journeyTime(row.scheduledAt ?? row.providerTimeAt);
      status = realtimeStateLabel(row);
      tone = 'disruption';
      break;
    case 'declared-realtime-no-source-time':
    case 'realtime-with-source-time': {
      time = journeyTime(row.predictedAt ?? row.providerTimeAt);
      const delay = delayMinutes(row);
      if (delay && row.scheduledAt !== undefined) scheduled = journeyTime(row.scheduledAt);
      const delayText = delay === undefined ? '' : delay === 0 ? ' · in orario' : delay > 0 ? ` · ritardo ${delay} min` : ` · anticipo ${-delay} min`;
      status = `${event}${delayText} · ${realtimeStateLabel(row)}`;
      tone = 'declared';
      break;
    }
    case 'scheduled':
      time = journeyTime(row.scheduledAt ?? row.providerTimeAt);
      status = realtimeStateLabel(row);
      tone = 'scheduled';
      break;
    default:
      // An unknown state shows the timetable time and says it is unconfirmed.
      time = journeyTime(row.scheduledAt ?? row.providerTimeAt);
      status = realtimeStateLabel(row);
      if (!status.includes('non confermato')) status += ' · orario non confermato';
      tone = 'caution';
  }
  const platform = platformText(row);
  const spokenLine = line || 'Linea non indicata';
  return {
    id: row.id, line, mode: boardModeBadge(row.mode), headsign, time, ...(scheduled ? { scheduled } : {}), status, tone,
    ...(platform ? { platform } : {}), ...(row.upstream.operator ? { operator: row.upstream.operator } : {}),
    accessibilityLabel: `${spokenLine}, ${headsign}, ${row.realtimeState === 'cancelled' ? 'cancellato' : `alle ${time}`}${scheduled ? `, programmato ${scheduled}` : ''}, ${status}${platform ? `, ${platform}` : ''}`,
  };
}

/** "Cerca su Transitous" is offered only when GTT realtime could not be retrieved or joined to the installed timetable. */
export function transitousFallbackOffered(board: StopBoard | null, arrivalsError: string): boolean {
  if (!board) return !!arrivalsError;
  return board.realtime.state === 'unavailable' || board.realtime.state === 'unmatched' || (!!arrivalsError && board.realtime.state !== 'ok');
}
