import test from 'node:test';
import assert from 'node:assert/strict';
import { rowPresentation } from '../features/transit/departure-status';
import type { GttBoardRow } from './board-model';
import { romeCivilTimes } from './calendar';
import { parseStopLive, sameDirection, stopLiveRows } from './stop-live';
import { rome } from './test-support/fixture';

// Shape of GTT's palina.getTransitiOld response for public stop 472 (sampled 2026-11-01, abridged).
const RESPONSE = [
  { Linea: 'ST2', LineaAlias: 'Star 2', PassaggiRT: ['21:29'], Passaggi: '21:36;22:21;', Direzione: 'PORTA SUSA, CORSO BOLZANO', Bacino: 'U', PassaggiPR: ['21:36', '22:21'] },
  { Linea: '15', LineaAlias: '15', PassaggiRT: ['21:35', '22:14'], Passaggi: '21:50;22:20;', Direzione: 'BORGATA LESNA, VIA BRISSOGNE', Bacino: 'U', PassaggiPR: ['21:50', '22:20'] },
  { Linea: 'METRO', LineaAlias: 'M1', PassaggiRT: ['21:31'], Direzione: 'METRO BENGASI', Bacino: 'U', PassaggiPR: ['21:28'] },
  { Linea: '5137', LineaAlias: '5137', PassaggiRT: ['21:50'], Direzione: 'PONT, CENTRO', Bacino: 'E', PassaggiPR: ['21:50'] },
  { Linea: '13', PassaggiRT: ['25:99', 'soon'], Direzione: 'X', Bacino: 'U' },
];
const AT = rome('20261101', '21:27');
const routes = new Map([
  ['ST2U', { routeId: 'ST2U', agencyId: 'U', routeType: 3, shortName: 'STAR 2' }],
  ['15U', { routeId: '15U', agencyId: 'U', routeType: 0, shortName: '15' }],
  ['METROU', { routeId: 'METROU', agencyId: 'U', routeType: 1, shortName: 'M1' }],
  ['13U', { routeId: '13U', agencyId: 'U', routeType: 0, shortName: '13' }],
]);
const board = (rows: GttBoardRow[] = []) => ({ stop: { id: '3019', name: 'Fermata 472 - CASTELLO' }, rows });

test('per-stop response: urban lines only, minute times in Rome, invalid times dropped', () => {
  const snapshot = parseStopLive(RESPONSE, '472', AT);
  assert.deepEqual(snapshot.lines.map(line => [line.routeId, line.realtime.length]), [['ST2U', 1], ['15U', 2], ['METROU', 1], ['13U', 0]]);
  assert.equal(snapshot.lines[0]!.realtime[0], rome('20261101', '21:29'));
  assert.equal(parseStopLive([{ Linea: '4', Bacino: 'U', PassaggiRT: ['00:03'] }], '472', rome('20261101', '23:58')).lines[0]!.realtime[0], rome('20261102', '00:03'), 'after midnight');
  assert.throws(() => parseStopLive({ error: true }, '472', AT));
});

test('per-stop rows: declared realtime without source time, metro stays scheduled, joined predictions win', () => {
  const snapshot = parseStopLive(RESPONSE, '472', AT);
  const joined = { gtt: { routeId: '15U', realtime: 'fresh', joinedBy: 'trip_id', tripId: 'T' }, headsign: 'BORGATA LESNA, VIA BRISSOGNE', predictedAt: rome('20261101', '21:35') + 40_000 } as unknown as GttBoardRow;
  const rows = stopLiveRows(snapshot, board([joined]), { now: AT, routes });
  assert.deepEqual(rows.map(row => [row.gtt.routeId, row.predictedAt]), [['ST2U', rome('20261101', '21:29')], ['15U', rome('20261101', '22:14')]]);
  const row = rows[0]!;
  assert.equal(row.realtimeState, 'declared-realtime-no-source-time');
  assert.equal(row.sourceUpdatedAt, undefined, 'no source timestamp is manufactured');
  assert.equal(row.retrievedAt, AT); assert.equal(row.line, 'STAR 2'); assert.equal(row.gtt.tripId, undefined);
  const view = rowPresentation(row, AT + 30_000);
  assert.equal(view.provenance, 'Tempo reale · GTT (fermata)');
  assert.equal(view.timeText, '21:29', 'minute precision, not a countdown');
  assert.match(rowPresentation(row, AT + 5 * 60_000).statusText, /consultata 5 min fa/);
  assert.equal(rowPresentation(row, AT + 31 * 60_000).timeText, '—');
});

test('autumn DST fold: an ambiguous HH:MM resolves to the occurrence nearest the retrieval', () => {
  assert.deepEqual(romeCivilTimes('20261025', 2, 25), [Date.parse('2026-10-25T00:25:00Z'), Date.parse('2026-10-25T01:25:00Z')]);
  assert.deepEqual(romeCivilTimes('20260329', 2, 30), [], 'spring gap');
  // Retrieved at 02:20 CET (the second 02:20): "02:25" is five minutes ahead, not an hour ago.
  const retrieved = Date.parse('2026-10-25T01:20:00Z');
  const snapshot = parseStopLive([{ Linea: '15', Bacino: 'U', PassaggiRT: ['02:25'] }], '472', retrieved);
  assert.equal(snapshot.lines[0]!.realtime[0], Date.parse('2026-10-25T01:25:00Z'));
  const rows = stopLiveRows(snapshot, board(), { now: retrieved, routes });
  assert.equal(rows.length, 1, 'kept as upcoming');
  // Retrieved at 02:20 CEST (the first 02:20): the first 02:25.
  assert.equal(parseStopLive([{ Linea: '15', Bacino: 'U', PassaggiRT: ['02:25'] }], '472', Date.parse('2026-10-25T00:20:00Z')).lines[0]!.realtime[0], Date.parse('2026-10-25T00:25:00Z'));
});

test('per-stop rows: unique keys per direction, suppression only for the same direction, no live label once expired', () => {
  const snapshot = parseStopLive([
    { Linea: '15', PassaggiRT: ['21:35', '21:35'], Direzione: 'BORGATA LESNA, VIA BRISSOGNE', Bacino: 'U' },
    { Linea: '15', PassaggiRT: ['21:35'], Direzione: 'SASSI', Bacino: 'U' },
  ], '472', AT);
  const joined = { gtt: { routeId: '15U', realtime: 'fresh', joinedBy: 'trip_id', tripId: 'T' }, headsign: 'BORGATA LESNA', predictedAt: rome('20261101', '21:35') } as unknown as GttBoardRow;
  const rows = stopLiveRows(snapshot, board([joined]), { now: AT, routes });
  assert.deepEqual(rows.map(row => row.headsign), ['SASSI'], 'the opposite direction is never hidden');
  const unjoined = stopLiveRows(snapshot, board(), { now: AT, routes });
  assert.equal(new Set(unjoined.map(row => row.id)).size, 3, 'distinct React keys');
  assert.equal(sameDirection('Borgata Lesna', 'BORGATA LESNA, VIA BRISSOGNE'), true);
  assert.equal(sameDirection('', 'SASSI'), false);
  assert.equal(rowPresentation(rows[0]!, AT + 31 * 60_000).provenance, 'Programmato · GTT');
});
