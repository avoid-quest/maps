import test from "node:test";
import assert from "node:assert/strict";
import { rowPresentation } from "./departure-status";
import type { GttBoardRow } from "../transit-data/board-model";

const base: GttBoardRow = {
  id: "gtt:T1:20261021:0:28800", provider: "gtt", upstream: { attribution: "Data source: GTT S.p.A. – Gruppo Torinese Trasporti" },
  event: "arrival", mode: "tram", line: "4", headsign: "Falchera", stop: { id: "A", name: "Alfa" },
  scheduledAt: 1_000_000, predictedAt: 1_120_000, timeBasis: "predicted", realtimeState: "realtime-with-source-time",
  tripCancelled: false, retrievedAt: 1_000_000, sourceUpdatedAt: 1_000_000,
  gtt: { routeId: "4U", tripId: "T1", serviceDate: "20261021", realtime: "fresh", delaySeconds: 120 },
};

test("live arrival shows minutes, delay and realtime provenance, then ages without a refresh", () => {
  const live = rowPresentation(base, 1_030_000);
  assert.equal(live.live, true); assert.equal(live.timeText, "2 min");
  assert.equal(live.statusText, "Arrivo previsto · ritardo 2 min");
  assert.equal(live.provenance, "Tempo reale · GTT");
  const stale = rowPresentation(base, 1_121_000);
  assert.equal(stale.live, false); assert.equal(stale.row.realtimeState, "unknown");
  assert.match(stale.statusText, /previsione di 2 min fa/);
  assert.equal(stale.provenance, "Tempo reale · GTT");
  const expired = rowPresentation(base, 1_000_000 + 31 * 60_000);
  assert.equal(expired.provenance, "Programmato · GTT"); assert.equal(expired.row.predictedAt, undefined);
});

test("scheduled, metro, cancelled and skipped rows keep honest labels", () => {
  const scheduled: GttBoardRow = { ...base, event: "departure", predictedAt: undefined, sourceUpdatedAt: undefined, timeBasis: "scheduled", realtimeState: "scheduled", gtt: { ...base.gtt, realtime: "no-trip-update", delaySeconds: undefined } };
  assert.equal(rowPresentation(scheduled, 900_000).provenance, "Programmato · GTT");
  assert.equal(rowPresentation(scheduled, 900_000).statusText, "Orario programmato · nessun dato in tempo reale");
  const metro: GttBoardRow = { ...scheduled, mode: "metro", gtt: { ...scheduled.gtt, realtime: "not-provided", note: "Solo orari programmati — tempo reale non disponibile" } };
  assert.equal(rowPresentation(metro, 900_000).statusText, "Solo orari programmati — tempo reale non disponibile");
  const cancelled: GttBoardRow = { ...scheduled, realtimeState: "cancelled", tripCancelled: true, sourceUpdatedAt: 1_000_000, gtt: { ...scheduled.gtt, realtime: "cancelled" } };
  assert.equal(rowPresentation(cancelled, 1_010_000).timeText, "—");
  assert.match(rowPresentation(cancelled, 1_010_000).statusText, /^Corsa cancellata/);
  const skipped: GttBoardRow = { ...cancelled, tripCancelled: false, gtt: { ...cancelled.gtt, realtime: "skipped" } };
  assert.match(rowPresentation(skipped, 1_010_000).statusText, /^Fermata soppressa per questa corsa/);
});

test("uncertain predictions are not plain countdowns", () => {
  const uncertain: GttBoardRow = { ...base, gtt: { ...base.gtt, uncertaintySeconds: 600 } };
  const view = rowPresentation(uncertain, 1_030_000);
  assert.ok(view.timeText.startsWith("~"), view.timeText);
  assert.match(view.statusText, /±10 min/);
  assert.equal(rowPresentation({ ...base, gtt: { ...base.gtt, uncertaintySeconds: 30 } }, 1_030_000).timeText, "2 min");
});

test("an aging cancellation report is shown with its age, then as no longer current", () => {
  const cancelled: GttBoardRow = { ...base, event: "departure", predictedAt: undefined, timeBasis: "scheduled", realtimeState: "cancelled", tripCancelled: true,
    gtt: { ...base.gtt, realtime: "cancelled", delaySeconds: undefined, report: { kind: "cancelled", reportedAt: 1_000_000 } } };
  assert.match(rowPresentation(cancelled, 1_060_000).statusText, /^Corsa cancellata/);
  const stale = rowPresentation(cancelled, 1_000_000 + 5 * 60_000);
  assert.notEqual(stale.timeText, "—", "no longer a definite cancellation");
  assert.match(stale.statusText, /^Cancellazione segnalata 5 min fa, non confermata/);
  assert.equal(stale.provenance, "Tempo reale · GTT");
  const expired = rowPresentation(cancelled, 1_000_000 + 40 * 60_000);
  assert.match(expired.statusText, /^Cancellazione segnalata 40 min fa, non più attuale/);
  assert.equal(expired.provenance, "Programmato · GTT");
  assert.notEqual(expired.timeText, "—", "the scheduled time is shown again");
});
