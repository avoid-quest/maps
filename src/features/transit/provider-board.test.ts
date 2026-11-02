import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransitBoardRow } from '../../domain/types';
import type { StopBoard } from '../../transit-data/board-model';
import { boardModeBadge, providerRowView, transitousFallbackOffered } from './provider-board';
import { metroOnlyStop, nearbyStopSubtitle } from './stop-labels';

const T = Date.parse('2026-11-02T11:00:00Z');
const min = (value: number) => T + value * 60_000;
function row(extra: Partial<TransitBoardRow> = {}): TransitBoardRow {
  return {
    id: 'r', provider: 'transitous', upstream: { operator: 'TRENITALIA', dataset: 'it_trenitalia.gtfs.zip' }, event: 'departure', mode: 'rail-suburban',
    line: 'SFM2', tripNumber: '26442', headsign: 'Chivasso', stop: { id: 'it-trenitalia_00222', name: 'TORINO PORTA SUSA' },
    scheduledAt: min(10), timeBasis: 'scheduled', realtimeState: 'scheduled', tripCancelled: false, retrievedAt: T, ...extra,
  };
}

test('declared realtime is labelled without a source update and with its delay, never as live', () => {
  const view = providerRowView(row({ realtimeState: 'declared-realtime-no-source-time', timeBasis: 'predicted', predictedAt: min(14), providerTimeAt: min(14), platform: { current: '5', changed: false } }));
  assert.equal(view.time, '12:14');
  assert.equal(view.scheduled, '12:10');
  assert.equal(view.status, 'Partenza · ritardo 4 min · Dichiarato in tempo reale · aggiornamento origine non disponibile');
  assert.equal(view.tone, 'declared');
  assert.equal(view.platform, 'Binario 5');
  assert.equal(view.line, 'SFM2 26442');
  assert.equal(view.mode, 'rail');
  const onTime = providerRowView(row({ realtimeState: 'declared-realtime-no-source-time', predictedAt: min(10) }));
  assert.equal(onTime.scheduled, undefined);
  assert.match(onTime.status, /^Partenza · in orario · Dichiarato/);
});

test('scheduled, unknown and cancelled rows keep their written state and timetable time', () => {
  assert.equal(providerRowView(row()).status, 'Orario programmato · nessun dato in tempo reale');
  assert.equal(providerRowView(row()).tone, 'scheduled');
  const unknown = providerRowView(row({ realtimeState: 'unknown', timeBasis: 'inconsistent', providerTimeAt: min(12) }));
  assert.equal(unknown.time, '12:10');
  assert.equal(unknown.tone, 'caution');
  assert.equal(unknown.status, 'Dati in tempo reale incoerenti · orario non confermato');
  assert.equal(providerRowView(row({ realtimeState: 'unknown', timeBasis: 'unknown' })).status, 'Stato in tempo reale non determinabile · orario non confermato');
  const cancelled = providerRowView(row({ realtimeState: 'cancelled', tripCancelled: true }));
  assert.equal(cancelled.status, 'Corsa cancellata');
  assert.equal(cancelled.tone, 'disruption');
  assert.match(cancelled.accessibilityLabel, /cancellato/);
  assert.equal(providerRowView(row({ realtimeState: 'cancelled', tripCancelled: false })).status, 'Fermata soppressa per questa corsa');
});

test('platforms: a changed track names the timetable one; a published track is shown as supplied', () => {
  assert.equal(providerRowView(row({ platform: { scheduled: '3', current: '7', changed: true } })).platform, 'Binario 7 · cambiato da 3');
  assert.equal(providerRowView(row({ platform: { scheduled: '3', changed: false } })).platform, 'Binario 3');
  assert.equal(providerRowView(row()).platform, undefined);
  assert.equal(providerRowView(row({ displayName: 'FR 9541', line: undefined })).line, 'FR 9541');
  assert.equal(providerRowView(row({ line: undefined, tripNumber: undefined, headsign: undefined, destination: 'Milano Centrale' })).headsign, 'Milano Centrale');
  assert.deepEqual(['bus', 'coach', 'tram', 'metro', 'rail-high-speed', 'ferry'].map(mode => boardModeBadge(mode as TransitBoardRow['mode'])), ['bus', 'bus', 'tram', 'metro', 'rail', undefined]);
});

test('Cerca su Transitous is offered only when GTT realtime is unavailable or unjoinable', () => {
  const board = (state: StopBoard['realtime']['state']) => ({ realtime: { state, tripUpdates: 0, matchedTrips: 0, unmatchedTrips: 0 } }) as StopBoard;
  assert.equal(transitousFallbackOffered(board('ok'), ''), false);
  assert.equal(transitousFallbackOffered(board('unavailable'), ''), true);
  assert.equal(transitousFallbackOffered(board('unmatched'), ''), true);
  assert.equal(transitousFallbackOffered(board('not-requested'), ''), false);
  assert.equal(transitousFallbackOffered(board('not-requested'), 'Rete assente'), true);
  assert.equal(transitousFallbackOffered(null, ''), false);
  assert.equal(transitousFallbackOffered(null, 'Rete assente'), true);
});

test('metro-only stops say they have timetable times only', () => {
  assert.equal(metroOnlyStop({ lines: ['M1'] }), true);
  assert.equal(metroOnlyStop({ lines: ['M1', '4'] }), false);
  assert.equal(metroOnlyStop({ lines: [] }), false);
  assert.equal(nearbyStopSubtitle({ code: '8221', lines: ['M1'] }), 'Fermata 8221 · M1 · Solo orari programmati — tempo reale non disponibile');
  assert.equal(nearbyStopSubtitle({ code: '472', lines: ['4', '15'] }), 'Fermata 472 · 4, 15');
});
