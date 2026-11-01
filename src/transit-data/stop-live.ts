import { GTT_ATTRIBUTION, type GttBoardRow } from './board-model';
import { addDays, romeCivilTime, romeDate } from './calendar';

/**
 * GTT's per-stop departures endpoint (opt-in). It returns, per line, minute-precision realtime
 * passages (`PassaggiRT`) and scheduled ones, with no trip IDs, timestamps or cancellations.
 * Rows built from it are "declared realtime without source time": retrieval time only, never
 * attached to a specific trip, and never replacing a trip-joined prediction.
 */
export const STOP_LIVE_SETTING = 'Tempo reale esteso dalla fermata (GTT)';
export const STOP_LIVE_DISCLOSURE = 'Disattivato di default. Se lo attivi, mentre una bacheca è aperta l’app chiede a GTT i passaggi di quella fermata (al massimo ogni 30 secondi): GTT riceve il codice della fermata consultata e il tuo indirizzo IP, non la tua posizione. Nessun cookie viene inviato o salvato. Gli orari sono al minuto, senza ora di aggiornamento della fonte e non collegati a una corsa specifica.';

export interface StopLiveLine { routeId: string; line: string; direction: string; realtime: number[] }
export interface StopLiveSnapshot { stopCode: string; retrievedAt: number; lines: StopLiveLine[] }

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** HH:MM in Rome nearest to the retrieval time (a 23:58 retrieval may list 00:03 tomorrow). */
function passage(value: string, retrievedAt: number): number | undefined {
  const match = TIME.exec(value);
  if (!match) return undefined;
  const today = romeDate(retrievedAt);
  const candidates = [addDays(today, -1), today, addDays(today, 1)]
    .map(date => romeCivilTime(date, +match[1]!, +match[2]!)).filter((at): at is number => at !== undefined);
  return candidates.sort((a, b) => Math.abs(a - retrievedAt) - Math.abs(b - retrievedAt))[0];
}

/** Strict parse; urban (bacino U) lines only. Unknown shapes yield no rows rather than guesses. */
export function parseStopLive(value: unknown, stopCode: string, retrievedAt: number): StopLiveSnapshot {
  if (!Array.isArray(value)) throw new Error('Risposta fermata GTT non valida.');
  const lines: StopLiveLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const { Linea: line, Bacino: area, Direzione: direction, PassaggiRT: realtime } = record;
    if (typeof line !== 'string' || !line || area !== 'U' || !Array.isArray(realtime)) continue;
    const times = realtime.flatMap(time => typeof time === 'string' ? [passage(time, retrievedAt)] : []).filter((at): at is number => at !== undefined);
    lines.push({ routeId: `${line}${area}`, line: typeof record.LineaAlias === 'string' && record.LineaAlias ? record.LineaAlias : line, direction: typeof direction === 'string' ? direction : '', realtime: times });
  }
  return { stopCode, retrievedAt, lines };
}

const DUPLICATE_WINDOW_MS = 90_000;

/**
 * Rows to add to a board: per-stop realtime passages of urban bus/tram lines that the citywide
 * feed did not already predict (same route within ±90 s of a trip-joined prediction). Metro and
 * lines not in the installed package stay scheduled-only.
 */
export function stopLiveRows(snapshot: StopLiveSnapshot, board: { stop: { id: string; name: string }; rows: readonly GttBoardRow[] }, context: {
  now: number; routes: Map<string, { routeId: string; agencyId: string; routeType: number; shortName: string }>; operator?: (agencyId: string) => string | undefined;
}): GttBoardRow[] {
  const joined = board.rows.filter(row => row.gtt.joinedBy && (row.predictedAt ?? row.providerTimeAt) !== undefined);
  const rows: GttBoardRow[] = [];
  for (const line of snapshot.lines) {
    const route = context.routes.get(line.routeId);
    // Only bus and tram routes of the installed package; metro stays scheduled (no GTT metro realtime).
    if (!route || (route.routeType !== 0 && route.routeType !== 3)) continue;
    for (const at of line.realtime) {
      if (at < context.now - 60_000) continue;
      if (joined.some(row => row.gtt.routeId === line.routeId && Math.abs((row.predictedAt ?? row.providerTimeAt)! - at) <= DUPLICATE_WINDOW_MS)) continue;
      rows.push({
        id: `gtt-stop:${snapshot.stopCode}:${line.routeId}:${at}`,
        provider: 'gtt',
        upstream: { ...(context.operator?.(route.agencyId) ? { operator: context.operator(route.agencyId)! } : {}), attribution: GTT_ATTRIBUTION, dataset: 'GTT palina.getTransitiOld' },
        event: 'arrival', mode: route.routeType === 0 ? 'tram' : 'bus', line: route.shortName || line.line,
        ...(line.direction ? { headsign: line.direction } : {}),
        stop: board.stop,
        predictedAt: at,
        timeBasis: 'predicted',
        // GTT supplies no source timestamp here; none is manufactured from the retrieval time.
        realtimeState: 'declared-realtime-no-source-time',
        tripCancelled: false,
        retrievedAt: snapshot.retrievedAt,
        gtt: { routeId: line.routeId, realtime: 'stop-live', source: 'stop', note: 'Previsione al minuto dal servizio fermata GTT: non collegata a una corsa specifica.' },
      });
    }
  }
  return rows;
}
