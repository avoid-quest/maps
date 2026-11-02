import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteLeg, RoutePlan, RouteStop, Stop } from '../../domain/types';
import { alternativeConfidence, alternativeRow, alternativeSegments, followableJourney, journeyTimeline, legProvenance, plannerPrimaryAction, rideSummary, walkRole, type PrimaryActionInput } from './transit-journey';

const T = Date.parse('2026-11-02T11:00:00Z'); // 12:00 in Rome
const min = (value: number) => T + value * 60_000;
function walk(id: string, from: number, to: number, meters = 300): RouteLeg {
  return { id, mode: 'walk', from: 'A', to: 'B', transitLeg: false, interlineWithPreviousLeg: false, timingStatus: 'unknown', realTime: false,
    durationSeconds: (to - from) * 60, distanceMeters: meters, departureAt: min(from), arrivalAt: min(to), geometry: [], steps: [] };
}
const stop = (name: string, code: string, platformCode?: string): RouteStop => ({ id: `mato:gtt:${code}`, name, code, coordinate: { latitude: 45.05, longitude: 7.66 }, ...(platformCode ? { platformCode } : {}) });
function ride(id: string, line: string, from: number, to: number, extra: Partial<RouteLeg> = {}): RouteLeg {
  return { id, mode: 'bus', line, headsign: 'NICHELINO', from: 'STAZIONE LINGOTTO', to: 'GARRONE', fromStop: stop('STAZIONE LINGOTTO', '2603'), toStop: stop('GARRONE', '488'),
    transitLeg: true, interlineWithPreviousLeg: false, timingStatus: 'scheduled', realTime: false,
    durationSeconds: (to - from) * 60, distanceMeters: 2000, departureAt: min(from), arrivalAt: min(to), geometry: [], steps: [], ...extra };
}
function plan(legs: RouteLeg[], extra: Partial<RoutePlan> = {}): RoutePlan {
  const boardings = legs.filter(leg => leg.transitLeg && !leg.interlineWithPreviousLeg).length;
  const walks = legs.filter(leg => leg.mode === 'walk');
  return { id: legs.map(leg => leg.id).join('|'), mode: 'transit', distanceMeters: 5000, durationSeconds: (legs.at(-1)!.arrivalAt! - legs[0]!.departureAt!) / 1000,
    departureAt: legs[0]!.departureAt, arrivalAt: legs.at(-1)!.arrivalAt,
    walkingDurationSeconds: walks.reduce((sum, leg) => sum + leg.durationSeconds, 0), walkingDistanceMeters: walks.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    waitingDurationSeconds: 0, transferCount: Math.max(0, boardings - 1), geometry: [], legs, source: 'MATO / 5T', warnings: [], fetchedAt: T, ...extra };
}
const twoLines = () => plan([walk('w1', 0, 4), ride('r1', '14', 6, 16), walk('w2', 16, 19, 220), ride('r2', '4', 22, 34, { mode: 'tram', timingStatus: 'prediction', realTime: true }), walk('w3', 34, 38)]);

test('an alternative row reads departure–arrival, line badges with a walked change, walking and changes', () => {
  const row = alternativeRow(twoLines(), T, 0);
  assert.equal(row.departure, '12:00');
  assert.equal(row.arrival, '12:38');
  assert.equal(row.duration, '38 min');
  assert.deepEqual(row.segments.map(item => item.kind === 'line' ? `${item.line}:${item.mode}` : item.kind === 'change' ? `change:${item.walk}` : 'stay'), ['14:bus', 'change:true', '4:tram']);
  assert.equal(row.walking, 'A piedi 11 min · 820 m');
  assert.equal(row.changes, '1 cambio');
  assert.deepEqual(row.confidence, { tone: 'scheduled', label: 'In parte programmato' });
  assert.match(row.accessibilityLabel, /^Alternativa 1: partenza 12:00, arrivo 12:38, 38 min, Linea 14, poi Linea 4, 1 cambio/);
  assert.equal(row.arrivalDay, undefined);
});

test('a same-vehicle continuation is a stay marker, not a change, and a change without walking says so', () => {
  const interline = plan([ride('a', '10', 0, 10), ride('b', '10N', 10, 20, { interlineWithPreviousLeg: true })]);
  assert.deepEqual(alternativeSegments(interline).map(item => item.kind), ['line', 'stay', 'line']);
  assert.equal(alternativeRow(interline, T).changes, 'Nessun cambio');
  const sameStop = plan([ride('a', '10', 0, 10), ride('b', '15', 12, 20)]);
  const change = alternativeSegments(sameStop)[1]!;
  assert.equal(change.kind === 'change' && change.walk, false);
  assert.equal(alternativeRow(sameStop, T).walking, 'Senza tratti a piedi');
});

test('confidence is the most severe word-labelled state: cancellation, passed departure, unknown, then timing mix', () => {
  assert.deepEqual(alternativeConfidence(plan([ride('a', '1', 0, 5, { timingStatus: 'cancelled' }), ride('b', '2', 5, 9, { timingStatus: 'unknown' })]), T), { tone: 'disruption', label: 'Corsa cancellata' });
  assert.deepEqual(alternativeConfidence(plan([ride('a', '1', 0, 5)]), min(3)), { tone: 'caution', label: 'Partenza già passata' });
  assert.deepEqual(alternativeConfidence(plan([ride('a', '1', 0, 5)]), min(0.9)), { tone: 'scheduled', label: 'Orari programmati' });
  assert.deepEqual(alternativeConfidence(plan([ride('a', '1', 0, 5, { timingStatus: 'unknown' })]), T), { tone: 'caution', label: 'Orario non confermato' });
  // MATO predictions carry no source timestamp: never the live tone.
  assert.deepEqual(alternativeConfidence(plan([ride('a', '1', 0, 5, { timingStatus: 'prediction', realTime: true })]), T), { tone: 'neutral', label: 'Previsione MATO' });
  assert.deepEqual(alternativeConfidence(plan([walk('w', 0, 20)]), T), { tone: 'neutral', label: 'Solo a piedi' });
});

test('an overnight journey names its arrival day', () => {
  const late = plan([ride('a', 'N4', 0, 90)], {});
  const shifted = { ...late, departureAt: Date.parse('2026-11-02T22:30:00Z'), arrivalAt: Date.parse('2026-11-03T00:00:00Z') };
  assert.equal(alternativeRow(shifted, T).arrivalDay, 'del 3 nov 2026');
});

const lingotto: Stop = { id: '1765', code: '2603', name: 'STAZIONE LINGOTTO', coordinate: { latitude: 45.05, longitude: 7.66 }, lines: ['14'] };
const matchLingotto = (routeStop: RouteStop | undefined) => routeStop?.code === '2603' ? lingotto : null;

test('the timeline runs access walk → board → ride → alight → transfer walk → … → arrive', () => {
  const items = journeyTimeline(twoLines(), { now: T, match: matchLingotto, destination: 'Gran Madre' });
  assert.deepEqual(items.map(item => item.kind === 'walk' ? `walk:${item.role}` : item.kind), [
    'walk:access', 'wait', 'board', 'ride', 'alight', 'walk:transfer', 'wait', 'board', 'ride', 'alight', 'walk:egress', 'arrive',
  ]);
  const board = items.find(item => item.kind === 'board')!;
  assert.ok(board.kind === 'board');
  assert.equal(board.stop.name, 'STAZIONE LINGOTTO');
  assert.equal(board.stop.code, '2603');
  assert.equal(board.direction, 'Direzione NICHELINO');
  assert.equal(board.at.time, '12:06');
  assert.equal(board.at.provenance, 'Orario programmato');
  assert.equal(board.stop.board?.id, '1765', 'validated endpoint links to its board');
  const alight = items.find(item => item.kind === 'alight')!;
  assert.ok(alight.kind === 'alight' && alight.stop.board === null, 'unvalidated endpoint has no board link');
  const arrive = items.at(-1)!;
  assert.ok(arrive.kind === 'arrive' && arrive.name === 'Gran Madre' && arrive.time === '12:38');
});

test('boarding shows platform and scheduled vs predicted time with MATO provenance', () => {
  const predicted = ride('r', '14', 8, 18, { timingStatus: 'prediction', realTime: true, scheduledDepartureAt: min(6), fromStop: stop('STAZIONE LINGOTTO', '2603', 'B') });
  const items = journeyTimeline(plan([predicted]), { now: T, match: () => null });
  const board = items.find(item => item.kind === 'board')!;
  assert.ok(board.kind === 'board');
  assert.deepEqual(board.at, { time: '12:08', scheduled: '12:06', provenance: 'Previsione MATO', tone: 'neutral' });
  assert.equal(board.stop.platform, 'B');
  // The same prediction becomes a refresh advisory once the plan is old.
  const old = journeyTimeline(plan([predicted]), { now: T + 5 * 60_000, match: () => null }).find(item => item.kind === 'board')!;
  assert.ok(old.kind === 'board' && old.at.provenance === 'Previsione MATO da aggiornare' && old.at.tone === 'caution');
  assert.deepEqual(legProvenance(ride('c', '1', 0, 1, { timingStatus: 'cancelled' }), false), { label: 'Corsa cancellata', tone: 'disruption' });
});

test('intermediate stops are listed when supplied and never guessed otherwise', () => {
  assert.equal(rideSummary(ride('a', '14', 0, 10)), 'Fermate intermedie non disponibili');
  assert.equal(rideSummary(ride('a', '14', 0, 10, { intermediateStops: [] })), 'Nessuna fermata intermedia indicata');
  const stops = [{ id: 'mato:gtt:2605', name: 'MONTE CORNO', code: '2605', arrivalAt: min(2) }, { id: 'mato:gtt:508', name: 'PASSO BUOLE', code: '508' }];
  const leg = ride('a', '14', 0, 10, { intermediateStops: stops });
  assert.equal(rideSummary(leg), '2 fermate intermedie');
  const item = journeyTimeline(plan([leg]), { now: T, match: () => null }).find(entry => entry.kind === 'ride')!;
  assert.ok(item.kind === 'ride' && item.stops?.length === 2 && item.duration === '10 min');
});

test('walk roles distinguish access, transfer, egress and walking-only plans', () => {
  const value = twoLines();
  assert.deepEqual([0, 2, 4].map(index => walkRole(value, index)), ['access', 'transfer', 'egress']);
  assert.equal(walkRole(plan([walk('w', 0, 10)]), 0), 'only');
});

const base: PrimaryActionInput = {
  mode: 'transit', route: null, loading: false, retained: false, picking: false, originPending: false, originReady: true,
  supported: true, navigationReady: true, navigationBusy: false,
};

test('Mezzi before any search offers Cerca percorsi, never a road Avvia', () => {
  assert.deepEqual(plannerPrimaryAction(base), { kind: 'search', label: 'Cerca percorsi', enabled: true, loading: false });
  assert.deepEqual(plannerPrimaryAction({ ...base, loading: true }), { kind: 'search', label: 'Cerca percorsi', enabled: false, loading: true });
  assert.equal(plannerPrimaryAction({ ...base, originReady: false }).reason, 'Scegli la partenza');
  // A road preview still in memory never makes Mezzi start walking guidance.
  const road = { ...plan([walk('w', 0, 10)]), mode: 'walk' as const };
  assert.equal(plannerPrimaryAction({ ...base, route: road }).kind, 'search');
});

test('Segui viaggio is enabled only for a selected followable transit alternative', () => {
  const route = twoLines();
  assert.deepEqual(plannerPrimaryAction({ ...base, route }), { kind: 'follow', label: 'Segui viaggio', enabled: true, loading: false });
  // Following needs no fix: a pending origin fix or a background refresh never disables it.
  assert.equal(plannerPrimaryAction({ ...base, route, originPending: true, loading: true }).enabled, true);
  assert.equal(plannerPrimaryAction({ ...base, route, retained: true }).reason, 'Scegli un’alternativa aggiornata');
  assert.equal(plannerPrimaryAction({ ...base, route: plan([ride('a', '1', 0, 5, { timingStatus: 'cancelled' })]) }).reason, 'Include una corsa cancellata');
  assert.equal(plannerPrimaryAction({ ...base, route: plan([walk('w', 0, 9)]) }).reason, 'Alternativa solo a piedi');
  assert.equal(plannerPrimaryAction({ ...base, route, navigationReady: false }).reason, 'Navigazione non pronta');
  assert.deepEqual(plannerPrimaryAction({ ...base, route, navigationBusy: true }), { kind: 'follow', label: 'Segui viaggio', enabled: false, loading: true });
  assert.equal(plannerPrimaryAction({ ...base, route, supported: false }).kind, 'none');
  assert.equal(followableJourney(route), true);
  assert.equal(followableJourney({ ...route, mode: 'walk' }), false);
});

test('road modes keep Avvia with their existing guards', () => {
  const road = { ...plan([walk('w', 0, 10)]), mode: 'walk' as const };
  const input = { ...base, mode: 'walk' as const, route: road };
  assert.deepEqual(plannerPrimaryAction(input), { kind: 'start', label: 'Avvia', enabled: true, loading: false });
  assert.equal(plannerPrimaryAction({ ...input, originPending: true }).enabled, false);
  assert.equal(plannerPrimaryAction({ ...input, loading: true }).enabled, false);
  assert.equal(plannerPrimaryAction({ ...input, route: twoLines() }).enabled, false, 'a transit plan cannot start road guidance');
});
