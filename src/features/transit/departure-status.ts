import { realtimeStateLabel } from "../../domain/transit-board";
import { agedRow, LABELS, preciseEnoughForCountdown, provenanceLabel, type GttBoardRow } from "../../transit-data/board-model";
import { journeyTime } from "../planner/journey-presentation";

export interface RowPresentation {
  row: GttBoardRow;
  timeText: string;
  statusText: string;
  /** Provenance beside the row: "Programmato · GTT" or "Tempo reale · GTT". */
  provenance: string;
  live: boolean;
  /** Explanation shown under the row: calendar extension or identity-joined provenance. */
  note?: string;
}

export const IDENTITY_JOIN_NOTE = 'Tempo reale abbinato per linea, direzione, percorso e partenza: GTT ha cambiato il codice della corsa.';
const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

function delayText(delay: number | undefined): string {
  if (delay === undefined) return "";
  if (Math.abs(delay) < 60) return " · in orario";
  return delay > 0 ? ` · ritardo ${minutes(delay * 1000)} min` : ` · anticipo ${minutes(-delay * 1000)} min`;
}

/** Re-evaluated every render: predictions age to "unknown" with their age, then disappear. */
export function rowPresentation(input: GttBoardRow, now: number): RowPresentation {
  const row = agedRow(input, now);
  const live = row.realtimeState === "realtime-with-source-time";
  const scheduled = row.scheduledAt !== undefined ? `Programmato ${journeyTime(row.scheduledAt)}` : "";
  const event = row.event === "arrival" ? "Arrivo previsto" : "Partenza prevista";
  const age = row.sourceUpdatedAt !== undefined ? minutes(now - row.sourceUpdatedAt) : undefined;
  let timeText: string;
  if (row.realtimeState === "cancelled") timeText = "—";
  else if (row.gtt.frequency && row.scheduledAt === undefined) timeText = `ogni ${minutes(row.gtt.frequency.headwaySeconds * 1000)} min`;
  else if (live && row.predictedAt! >= now && preciseEnoughForCountdown(row)) timeText = `${Math.ceil((row.predictedAt! - now) / 60_000)} min`;
  else timeText = `${!preciseEnoughForCountdown(row) && row.providerTimeAt === undefined && row.predictedAt !== undefined ? "~" : ""}${journeyTime(row.predictedAt ?? row.providerTimeAt ?? row.scheduledAt)}`;
  // A highly uncertain prediction is never a plain countdown: it carries its "± N min".
  const uncertainty = row.gtt.uncertaintySeconds !== undefined && !preciseEnoughForCountdown(row) ? ` · ±${minutes(row.gtt.uncertaintySeconds * 1000)} min` : "";
  const report = row.gtt.report;
  const reported = (current: boolean) => report?.kind === "skipped"
    ? `Salto della fermata segnalato ${age ?? "?"} min fa, ${current ? "non confermato" : "non più attuale"}`
    : `Cancellazione segnalata ${age ?? "?"} min fa, ${current ? "non confermata" : "non più attuale"}`;
  let statusText: string;
  const consulted = minutes(now - row.retrievedAt);
  if (row.gtt.source === "stop") {
    const statusText = row.gtt.realtime === "stop-live" ? `Passaggio previsto al minuto · consultato alle ${journeyTime(row.retrievedAt)}`
      : row.gtt.realtime === "stale" ? `Previsione dalla fermata consultata ${consulted} min fa`
      : "Previsione dalla fermata non più attuale";
    return { row, timeText: row.gtt.realtime === "expired" ? "—" : journeyTime(row.predictedAt ?? row.providerTimeAt), statusText, provenance: provenanceLabel(row), live: false };
  }
  switch (row.gtt.realtime) {
    case "fresh": statusText = `${event}${delayText(row.gtt.delaySeconds)}${uncertainty}${row.gtt.propagated ? " (da fermata precedente)" : ""}`; break;
    case "stale":
      statusText = report
        ? `${reported(true)}${scheduled ? ` · ${scheduled}` : ""}`
        : `${event} · previsione di ${age ?? "?"} min fa${uncertainty}${scheduled ? ` · ${scheduled}` : ""}`;
      break;
    case "expired":
      statusText = report
        ? `${reported(false)}${scheduled ? ` · ${scheduled}` : ""}`
        : realtimeStateLabel(row);
      break;
    case "not-provided": statusText = row.gtt.note ?? LABELS.metroScheduledOnly; break;
    case "before-first-update": statusText = row.gtt.note ?? realtimeStateLabel(row); break;
    case "no-trip-update":
      statusText = row.gtt.frequency && row.scheduledAt === undefined ? `Frequenza programmata fino alle ${journeyTime(row.gtt.frequency.until)}` : realtimeStateLabel(row); break;
    default: statusText = `${realtimeStateLabel(row)}${row.realtimeState === "cancelled" && scheduled ? ` · ${scheduled}` : ""}`;
  }
  // The calendar-extension note explains why a row outside the installed calendar is shown at
  // all; an identity join otherwise gets its own provenance line. Only while realtime backs it.
  const backed = row.gtt.realtime === "fresh" || row.gtt.realtime === "stale" || row.gtt.realtime === "cancelled" || row.gtt.realtime === "skipped";
  const note = row.gtt.calendar === "realtime-identity" ? row.gtt.note : backed && row.gtt.joinedBy === "identity" ? IDENTITY_JOIN_NOTE : undefined;
  return { row, timeText, statusText, provenance: provenanceLabel(row), live, ...(note ? { note } : {}) };
}
