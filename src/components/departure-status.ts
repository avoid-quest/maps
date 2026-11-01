import { realtimeStateLabel } from "../domain/transit-board";
import { agedRow, LABELS, provenanceLabel, type GttBoardRow } from "../transit-data/board-model";
import { journeyTime } from "./journey-presentation";

export interface RowPresentation {
  row: GttBoardRow;
  timeText: string;
  statusText: string;
  /** Provenance beside the row: "Programmato · GTT" or "Tempo reale · GTT". */
  provenance: string;
  live: boolean;
}

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
  else if (live && row.predictedAt! >= now) timeText = `${Math.ceil((row.predictedAt! - now) / 60_000)} min`;
  else timeText = journeyTime(row.predictedAt ?? row.providerTimeAt ?? row.scheduledAt);
  let statusText: string;
  switch (row.gtt.realtime) {
    case "fresh": statusText = `${event}${delayText(row.gtt.delaySeconds)}${row.gtt.propagated ? " (da fermata precedente)" : ""}`; break;
    case "stale": statusText = `${event} · previsione di ${age ?? "?"} min fa${scheduled ? ` · ${scheduled}` : ""}`; break;
    case "not-provided": statusText = row.gtt.note ?? LABELS.metroScheduledOnly; break;
    case "before-first-update": statusText = row.gtt.note ?? realtimeStateLabel(row); break;
    case "no-trip-update":
      statusText = row.gtt.frequency && row.scheduledAt === undefined ? `Frequenza programmata fino alle ${journeyTime(row.gtt.frequency.until)}` : realtimeStateLabel(row); break;
    default: statusText = `${realtimeStateLabel(row)}${row.realtimeState === "cancelled" && scheduled ? ` · ${scheduled}` : ""}`;
  }
  return { row, timeText, statusText, provenance: provenanceLabel(row), live };
}
