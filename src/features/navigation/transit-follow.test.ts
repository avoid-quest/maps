import test from 'node:test';
import assert from 'node:assert/strict';
import { idleNavigation, type NavigationSnapshot } from '../../domain/navigation';
import type { RouteLeg, RoutePlan } from '../../domain/types';
import type { GttBoardRow } from '../../transit-data/board-model';
import { currentStepKey, followBoarding, liveBoarding, matchBoardingRow, sessionPlan, transitFollowModel } from './transit-follow';

const T = Date.parse('2026-11-02T11:00:00Z');
const min = (value: number) => T + value * 60_000;
const walk = (id: string, from: number, to: number): RouteLeg => ({ id, mode: 'walk', from: 'A', to: 'B', transitLeg: false, interlineWithPreviousLeg: false, timingStatus: 'unknown', realTime: false,
  durationSeconds: (to - from) * 60, distanceMeters: 300, departureAt: min(from), arrivalAt: min(to), geometry: [], steps: [] });
const ride = (id: string, line: string, from: number, to: number, extra: Partial<RouteLeg> = {}): RouteLeg => ({ id, mode: 'bus', line, headsign: 'NICHELINO',
  from: 'STAZIONE LINGOTTO', to: 'GARRONE', fromStop: { id: 'mato:gtt:2603', name: 'STAZIONE LINGOTTO', code: '2603' }, toStop: { id: 'mato:gtt:488', name: 'GARRONE', code: '488' },
  tripId: `mato:gtt:${id}U`, serviceDate: '20261102', transitLeg: true, interlineWithPreviousLeg: false, timingStatus: 'scheduled', realTime: false,
  durationSeconds: (to - from) * 60, distanceMeters: 2000, departureAt: min(from), arrivalAt: min(to), geometry: [], steps: [], ...extra });
const journey: RoutePlan = {
  id: 'j', mode: 'transit', distanceMeters: 6000, durationSeconds: 38 * 60, departureAt: min(0), arrivalAt: min(38),
  walkingDurationSeconds: 600, walkingDistanceMeters: 900, waitingDurationSeconds: 0, transferCount: 1, geometry: [], source: 'MATO / 5T', warnings: [], fetchedAt: T,
  legs: [walk('w1', 0, 4), ride('284', '14', 6, 16), walk('w2', 16, 19), ride('911', '4', 22, 34, { fromStop: { id: 'mato:gtt:470', name: 'CARDUCCI', code: '470' } }), walk('w3', 34, 38)],
};
type Phase = NonNullable<NavigationSnapshot['transit']>['phase'];
function session(phase: Phase, legIndex: number, extra: Partial<NonNullable<NavigationSnapshot['transit']>> = {}, top: Partial<NavigationSnapshot> = {}): NavigationSnapshot {
  return {
    ...idleNavigation, revision: 3, sessionId: 's', status: 'navigating', mode: 'transit', notificationGranted: true, instruction: 'Istruzione nativa',
    transit: {
      phase, legIndex, legCount: 5, sourceLegIndices: [legIndex], timingStatus: 'scheduled', fetchedAt: T,
      canConfirmWalking: phase === 'walk' || phase === 'transfer', canConfirmBoarding: phase === 'board', canConfirmAlighting: phase === 'ride' || phase === 'alight',
      journeyArrivalAt: min(38), ...extra,
    },
    ...top,
  };
}

test('each native phase maps to a following stage with its anchored next action', () => {
  const cases: [NavigationSnapshot, string, string | undefined][] = [
    [session('walk', 0, { nextBoardingAt: min(6) }), 'access-walk', 'Sono alla fermata'],
    [session('board', 1, { nextBoardingAt: min(6) }), 'waiting', 'Sono a bordo'],
    [session('ride', 1, { nextBoardingAt: min(22) }), 'riding', 'Sono sceso'],
    [session('alight', 1), 'riding', 'Sono sceso'],
    [session('transfer', 2, { nextBoardingAt: min(22) }), 'transfer', 'Sono alla fermata'],
    [session('walk', 4), 'final-walk', 'Sono arrivato'],
    [session('complete', 4, {}, { status: 'arrived' }), 'arrived', undefined],
  ];
  for (const [snapshot, stage, label] of cases) {
    const model = transitFollowModel(snapshot, journey, min(1));
    assert.equal(model.stage, stage, `${snapshot.transit?.phase}`);
    assert.equal(model.action?.label, label, `${snapshot.transit?.phase}`);
  }
  // Without the plan, the native next boarding still separates access from the final walk.
  assert.equal(transitFollowModel(session('walk', 0, { nextBoardingAt: min(6) }), null, T).stage, 'access-walk');
  assert.equal(transitFollowModel(session('walk', 4), null, T).stage, 'final-walk');
});

test('a start in flight and an interrupted session have their own stages', () => {
  assert.equal(transitFollowModel({ ...idleNavigation }, journey, T).stage, 'starting');
  const interrupted = transitFollowModel({ ...idleNavigation, sessionId: 's', mode: 'transit', status: 'interrupted', canRetry: true }, journey, T);
  assert.equal(interrupted.stage, 'ended');
  assert.equal(interrupted.action, null);
});

test('the next boarding comes from the matching plan; while aboard it is the next connection', () => {
  const access = followBoarding(session('walk', 0, { nextBoardingAt: min(6) }), journey)!;
  assert.equal(access.leg?.id, '284');
  assert.equal(access.role, 'next');
  assert.equal(access.stopCode, '2603');
  assert.equal(followBoarding(session('board', 1), journey)!.leg?.id, '284');
  const aboard = followBoarding(session('ride', 1, { nextBoardingAt: min(22) }), journey)!;
  assert.equal(aboard.leg?.id, '911');
  assert.equal(aboard.role, 'connection');
  assert.equal(followBoarding(session('ride', 3), journey), null, 'no connection after the last ride');
  // A different plan (another retrieval) never describes this session.
  assert.equal(sessionPlan(session('board', 1), { ...journey, fetchedAt: T - 1 }), null);
  assert.equal(followBoarding(session('board', 1, { line: '14', from: 'STAZIONE LINGOTTO' }), { ...journey, fetchedAt: T - 1 })?.leg, null);
});

test('journey age, passed boarding and proximity stay advisory and explicit', () => {
  const fresh = transitFollowModel(session('board', 1, { nextBoardingAt: min(6) }), journey, min(1));
  assert.equal(fresh.age, 'Viaggio consultato alle 12:00 · 1 min fa');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.warning, null);
  assert.equal(fresh.proximity, 'Posizione non disponibile: conferma ogni passaggio manualmente.');
  const missed = transitFollowModel(session('board', 1, { nextBoardingAt: min(6) }), journey, min(9));
  assert.equal(missed.stale, true);
  assert.match(missed.warning ?? '', /già partita/);
  const ended = transitFollowModel(session('ride', 3), journey, min(45));
  assert.match(ended.warning ?? '', /già concluso/);
  const near = transitFollowModel(session('board', 1, { proximityAvailable: true }, { locationUsable: true, distanceToManeuverMeters: 123 }), journey, T);
  assert.equal(near.proximity, 'Circa 120 m in linea d’aria · solo indicativo');
  const ambiguous = transitFollowModel(session('ride', 1, { proximityAvailable: false }, { locationUsable: true, distanceToManeuverMeters: 50 }), journey, T);
  assert.match(ambiguous.proximity ?? '', /conferma manualmente/);
  assert.equal(ambiguous.alighting?.stopName, 'GARRONE');
});

function row(extra: Omit<Partial<GttBoardRow>, 'gtt'> & { gtt?: Partial<GttBoardRow['gtt']> } = {}): GttBoardRow {
  const { gtt, ...rest } = extra;
  return {
    id: 'row', provider: 'gtt', upstream: {}, event: 'departure', mode: 'bus', line: '14', headsign: 'NICHELINO', stop: { id: '1765', name: 'STAZIONE LINGOTTO' },
    scheduledAt: min(6), timeBasis: 'scheduled', realtimeState: 'scheduled', tripCancelled: false, retrievedAt: T,
    gtt: { routeId: '14U', tripId: 'other', serviceDate: '20261102', realtime: 'no-trip-update', ...gtt }, ...rest,
  };
}

test('the live row joins by GTT trip ID first, then by line and scheduled time only when unique', () => {
  const leg = journey.legs[1]!;
  assert.equal(matchBoardingRow([row({ id: 'trip', scheduledAt: min(30), gtt: { tripId: '284U' } })], leg)?.method, 'trip');
  assert.equal(matchBoardingRow([row({ gtt: { tripId: '284U', serviceDate: '20261103' } })], leg)?.method, 'schedule', 'another service day is not the same trip');
  assert.equal(matchBoardingRow([row({ id: 'a' })], leg)?.row.id, 'a');
  assert.equal(matchBoardingRow([row({ id: 'a' }), row({ id: 'b', scheduledAt: min(6) + 20_000 })], leg), null, 'two candidates: no guess');
  assert.equal(matchBoardingRow([row({ line: '15' })], leg), null);
  assert.equal(matchBoardingRow([row({ scheduledAt: min(7) })], leg), null);
  // A MATO prediction joins on its timetable time, not on the predicted one.
  const predicted = { ...leg, timingStatus: 'prediction' as const, realTime: true, departureAt: min(8), scheduledDepartureAt: min(6), tripId: undefined };
  assert.equal(matchBoardingRow([row()], predicted)?.method, 'schedule');
  assert.equal(matchBoardingRow([row()], { ...leg, timingStatus: 'unknown', tripId: undefined }), null, 'an unknown timing state cannot be joined by time');
});

test('live boarding: green only for fresh sourced realtime; otherwise unconfirmed or unavailable in words', () => {
  const leg = journey.legs[1]!;
  const live = liveBoarding({ leg, boardAvailable: true, loading: false, now: T, rows: [row({
    predictedAt: min(8), realtimeState: 'realtime-with-source-time', timeBasis: 'predicted', sourceUpdatedAt: T - 20_000,
    gtt: { tripId: '284U', realtime: 'fresh', delaySeconds: 120 },
  })] });
  assert.equal(live.state, 'matched');
  assert.equal(live.live, true);
  assert.equal(live.tone, 'live');
  assert.equal(live.timeText, '8 min');
  assert.equal(live.provenance, 'Tempo reale · GTT');
  const stale = liveBoarding({ leg, boardAvailable: true, loading: false, now: T + 5 * 60_000, rows: [row({
    predictedAt: min(8), realtimeState: 'realtime-with-source-time', timeBasis: 'predicted', sourceUpdatedAt: T - 20_000,
    gtt: { tripId: '284U', realtime: 'fresh' },
  })] });
  assert.equal(stale.live, false, 'an aged prediction is never shown as live');
  assert.equal(stale.tone, 'caution');
  const unconfirmed = liveBoarding({ leg, boardAvailable: true, loading: false, now: T, rows: [row({ line: '15' })] });
  assert.equal(unconfirmed.status, 'Corsa non confermata');
  assert.equal(unconfirmed.state, 'unconfirmed');
  assert.equal(liveBoarding({ leg, boardAvailable: false, loading: false, now: T, rows: null }).state, 'unavailable');
  assert.equal(liveBoarding({ leg, boardAvailable: true, loading: true, now: T, rows: null }).state, 'loading');
  const metro = liveBoarding({ leg: { ...leg, line: 'M1', mode: 'subway', tripId: undefined }, boardAvailable: true, loading: false, now: T,
    rows: [row({ line: 'M1', mode: 'metro', gtt: { realtime: 'not-provided' } })] });
  assert.equal(metro.status, 'Solo orari programmati — tempo reale non disponibile');
  assert.equal(metro.note, 'Corsa abbinata per linea e orario programmato');
});

test('one timeline step is current, and an unconfirmed service lists the line’s passages separately', () => {
  assert.equal(currentStepKey(session('walk', 0), journey), 'walk:w1');
  assert.equal(currentStepKey(session('board', 1), journey), 'board:284');
  assert.equal(currentStepKey(session('alight', 1), journey), 'ride:284');
  assert.equal(currentStepKey(session('board', 1), null), undefined);
  const leg = journey.legs[1]!;
  const result = liveBoarding({ leg, boardAvailable: true, loading: false, now: T, rows: [row({ id: 'x', scheduledAt: min(9) }), row({ id: 'y', line: '15' })] });
  assert.equal(result.state, 'unconfirmed');
  assert.deepEqual(result.sameLine?.map(item => [item.id, item.time]), [['x', '12:09']]);
});
