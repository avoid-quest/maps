import { navigationPresentation, type NavigationSnapshot, type TransitConfirmation } from '../../domain/navigation';
import type { RouteLeg, RoutePlan } from '../../domain/types';
import type { GttBoardRow } from '../../transit-data/board-model';
import { rowPresentation, visibleRows } from '../transit/departure-status';
import { journeyTime } from '../planner/journey-presentation';
import { PLAN_FRESH_MS } from '../planner/transit-journey';

/**
 * The transit following screen, derived from the native snapshot (the session's source of truth)
 * and, when it is the same journey, the plan the session was started with. GPS cues stay advisory:
 * every transition needs the rider's confirmation.
 */
export type FollowStage = 'starting' | 'access-walk' | 'waiting' | 'riding' | 'transfer' | 'final-walk' | 'arrived' | 'ended';

export interface FollowAction { confirm: TransitConfirmation; label: string }
export interface FollowBoarding {
  /** The plan leg, when the started plan matches the session. */
  leg: RouteLeg | null;
  line?: string;
  headsign?: string;
  stopName?: string;
  stopCode?: string;
  platform?: string;
  /** Planned departure (MATO's expected time). */
  departureAt?: number;
  /** "Prossima partenza" before boarding; "Coincidenza" while aboard. */
  role: 'next' | 'connection';
}
export interface TransitFollowModel {
  stage: FollowStage;
  title: string;
  instruction: string;
  action: FollowAction | null;
  boarding: FollowBoarding | null;
  /** Where to get off while riding. */
  alighting: { stopName?: string; arrivalAt?: number } | null;
  /** "Viaggio consultato alle 12:01 · 7 min fa". */
  age: string;
  stale: boolean;
  /** Passed or missed planned times, from the native journeyEnd/nextBoarding fields. */
  warning: string | null;
  /** Straight-line GPS distance or why it is missing; never a confirmation. */
  proximity: string | null;
  progress: string;
}

const STAGE_TITLES: Record<FollowStage, string> = {
  starting: 'Avvio del viaggio', 'access-walk': 'Raggiungi la fermata', waiting: 'Attendi alla fermata', riding: 'A bordo',
  transfer: 'Cambio', 'final-walk': 'Verso la destinazione', arrived: 'Sei arrivato', ended: 'Viaggio interrotto',
};
const ACTION_LABELS: Record<TransitConfirmation, Partial<Record<FollowStage, string>>> = {
  'walk-complete': { 'access-walk': 'Sono alla fermata', transfer: 'Sono alla fermata', 'final-walk': 'Sono arrivato' },
  board: { waiting: 'Sono a bordo' },
  alight: { riding: 'Sono sceso' },
};

/** The started plan describes this session only when its retrieval time and leg count agree. */
export function sessionPlan(snapshot: NavigationSnapshot, plan: RoutePlan | null): RoutePlan | null {
  const transit = snapshot.transit;
  if (!plan || !transit || snapshot.mode !== 'transit') return null;
  return plan.fetchedAt === transit.fetchedAt && plan.legs.length === transit.legCount ? plan : null;
}

function currentLegs(snapshot: NavigationSnapshot): number[] {
  const transit = snapshot.transit!;
  return transit.sourceLegIndices?.length ? transit.sourceLegIndices : [transit.legIndex];
}

function stageOf(snapshot: NavigationSnapshot, plan: RoutePlan | null): FollowStage {
  const transit = snapshot.transit;
  if (snapshot.status === 'arrived' || transit?.phase === 'complete') return 'arrived';
  if (snapshot.status === 'interrupted' || snapshot.status === 'error') return 'ended';
  if (!transit) return 'starting';
  switch (transit.phase) {
    case 'board': return 'waiting';
    case 'ride': case 'alight': return 'riding';
    case 'transfer': return 'transfer';
    case 'walk': {
      const last = Math.max(...currentLegs(snapshot));
      const transitAhead = plan ? plan.legs.slice(last + 1).some(leg => leg.transitLeg) : transit.nextBoardingAt != null;
      return transitAhead ? 'access-walk' : 'final-walk';
    }
    default: return 'starting';
  }
}

function boardingFor(stage: FollowStage, snapshot: NavigationSnapshot, plan: RoutePlan | null): FollowBoarding | null {
  const transit = snapshot.transit;
  if (!transit || stage === 'arrived' || stage === 'ended' || stage === 'starting' || stage === 'final-walk') return null;
  const legs = currentLegs(snapshot);
  const role: FollowBoarding['role'] = stage === 'riding' ? 'connection' : 'next';
  if (plan) {
    const from = stage === 'waiting' ? legs[0]! : Math.max(...legs) + 1;
    // While aboard, the next connection is the next boarding after this vehicle (not a same-vehicle continuation).
    const leg = plan.legs.slice(from).find(item => item.transitLeg && (stage === 'waiting' || !item.interlineWithPreviousLeg)) ?? null;
    if (!leg) return null;
    return {
      leg, line: leg.line, headsign: leg.headsign, stopName: leg.fromStop?.name ?? leg.from, stopCode: leg.fromStop?.code,
      platform: leg.fromStop?.platformCode, departureAt: leg.departureAt, role,
    };
  }
  if (stage === 'waiting') return { leg: null, line: transit.line, headsign: transit.headsign, stopName: transit.from, departureAt: transit.departureAt, role };
  return transit.nextBoardingAt != null ? { leg: null, departureAt: transit.nextBoardingAt, role } : null;
}

/** The next boarding of the followed journey, without time-dependent wording (for the live board). */
export function followBoarding(snapshot: NavigationSnapshot, startedPlan: RoutePlan | null): FollowBoarding | null {
  const plan = sessionPlan(snapshot, startedPlan);
  return boardingFor(stageOf(snapshot, plan), snapshot, plan);
}

const minutesAgo = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

export function transitFollowModel(snapshot: NavigationSnapshot, startedPlan: RoutePlan | null, now: number): TransitFollowModel {
  const plan = sessionPlan(snapshot, startedPlan);
  const stage = stageOf(snapshot, plan);
  const transit = snapshot.transit;
  const presentation = navigationPresentation(snapshot, now);
  const confirm = transit?.confirmation
    ?? (transit?.canConfirmWalking ? 'walk-complete' : transit?.canConfirmBoarding ? 'board' : transit?.canConfirmAlighting ? 'alight' : undefined);
  const label = confirm ? ACTION_LABELS[confirm][stage] : undefined;
  const action = confirm && label ? { confirm, label } : null;
  const fetchedAt = transit?.fetchedAt ?? plan?.fetchedAt;
  const ageMs = fetchedAt != null ? now - fetchedAt : 0;
  const age = fetchedAt != null
    ? `Viaggio consultato alle ${journeyTime(fetchedAt)} · ${minutesAgo(ageMs) < 1 ? 'meno di 1 min fa' : `${minutesAgo(ageMs)} min fa`}`
    : 'Consultazione del viaggio non disponibile';
  const alightingLeg = plan && transit && stage === 'riding' ? plan.legs[Math.max(...currentLegs(snapshot))] : undefined;
  const alighting = stage === 'riding' ? { stopName: alightingLeg?.toStop?.name ?? alightingLeg?.to ?? transit?.to, arrivalAt: alightingLeg?.arrivalAt ?? transit?.arrivalAt } : null;
  let proximity: string | null = null;
  if (transit && stage !== 'arrived' && stage !== 'ended') {
    if (snapshot.locationUsable === true && transit.proximityAvailable !== false && snapshot.distanceToManeuverMeters != null) {
      const meters = snapshot.distanceToManeuverMeters;
      proximity = `Circa ${meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`} in linea d’aria · solo indicativo`;
    } else if (transit.proximityAvailable === false) proximity = 'Vicinanza non disponibile per questa tratta: conferma manualmente.';
    else proximity = 'Posizione non disponibile: conferma ogni passaggio manualmente.';
  }
  return {
    stage, title: STAGE_TITLES[stage],
    instruction: stage === 'ended' ? presentation.quality : snapshot.instruction ?? (stage === 'starting' ? 'Preparazione del viaggio' : presentation.instruction),
    action, boarding: boardingFor(stage, snapshot, plan), alighting, age, stale: ageMs >= PLAN_FRESH_MS,
    warning: presentation.transitWarning, proximity,
    progress: transit ? `Tratta ${transit.legIndex + 1} di ${transit.legCount}` : '',
  };
}

// ---------------------------------------------------------------------------------------------
// Live departure for the next boarding, from the stop's GTT board

export interface BoardingMatch { row: GttBoardRow; method: 'trip' | 'schedule' }

/**
 * Joins the selected service to a GTT board row: by GTT trip ID (and service date), else by the same
 * line with the same scheduled departure at this stop when exactly one row qualifies. Anything else
 * is unmatched; the rider sees "Corsa non confermata" rather than a guessed vehicle.
 */
export function matchBoardingRow(rows: readonly GttBoardRow[], leg: RouteLeg): BoardingMatch | null {
  const trip = /^mato:gtt:([A-Za-z0-9_.-]+)$/.exec(leg.tripId ?? '')?.[1];
  if (trip) {
    const exact = rows.filter(row => row.gtt.tripId === trip && (!leg.serviceDate || !row.gtt.serviceDate || row.gtt.serviceDate === leg.serviceDate));
    if (exact.length === 1) return { row: exact[0]!, method: 'trip' };
  }
  const scheduled = leg.scheduledDepartureAt ?? (leg.timingStatus === 'scheduled' || leg.timingStatus === 'prediction' ? leg.departureAt : undefined);
  const line = leg.line?.trim().toUpperCase();
  if (scheduled == null || !line) return null;
  const candidates = rows.filter(row => row.line?.trim().toUpperCase() === line && row.scheduledAt != null && Math.abs(row.scheduledAt - scheduled) < 60_000);
  return candidates.length === 1 ? { row: candidates[0]!, method: 'schedule' } : null;
}

export interface LiveBoarding {
  state: 'matched' | 'unconfirmed' | 'unavailable' | 'loading';
  /** Time to show, from the board row when matched. */
  timeText?: string;
  live: boolean;
  status?: string;
  provenance: string;
  note?: string;
  tone: 'live' | 'scheduled' | 'caution' | 'disruption' | 'neutral';
  /** When the selected service is unconfirmed: the line's next passages at this stop, never presented as that service. */
  sameLine?: { id: string; time: string; provenance: string; live: boolean }[];
}

/** Key of the timeline step being followed, matching `journeyTimeline` keys. */
export function currentStepKey(snapshot: NavigationSnapshot, plan: RoutePlan | null): string | undefined {
  const transit = snapshot.transit;
  if (!plan || !transit) return undefined;
  const legs = currentLegs(snapshot);
  const leg = plan.legs[legs[0]!];
  if (!leg) return undefined;
  if (transit.phase === 'board') return `board:${leg.id}`;
  if (transit.phase === 'ride' || transit.phase === 'alight') return `ride:${leg.id}`;
  if (transit.phase === 'walk' || transit.phase === 'transfer') return `walk:${leg.id}`;
  return undefined;
}

export function liveBoarding(input: { leg: RouteLeg | null; rows: readonly GttBoardRow[] | null; boardAvailable: boolean; loading: boolean; error?: string; now: number }): LiveBoarding {
  if (!input.leg || !input.boardAvailable) return { state: 'unavailable', live: false, provenance: 'Partenze dal vivo non disponibili per questa fermata', tone: 'neutral' };
  if (!input.rows) return input.loading
    ? { state: 'loading', live: false, provenance: 'Cerco la partenza alla fermata…', tone: 'neutral' }
    : { state: 'unavailable', live: false, provenance: input.error || 'Partenze della fermata non disponibili', tone: 'caution' };
  const match = matchBoardingRow(input.rows, input.leg);
  if (!match) {
    const line = input.leg.line?.trim().toUpperCase();
    const sameLine = line ? visibleRows(input.rows, input.now).filter(row => row.line?.trim().toUpperCase() === line).slice(0, 2).map(row => {
      const view = rowPresentation(row, input.now);
      return { id: row.id, time: view.timeText, provenance: view.statusText === view.provenance ? view.provenance : `${view.statusText} · ${view.provenance}`, live: view.live };
    }) : [];
    return { state: 'unconfirmed', live: false, status: 'Corsa non confermata', provenance: 'La corsa scelta non risulta tra le partenze GTT della fermata', tone: 'caution', ...(sameLine.length ? { sameLine } : {}) };
  }
  const view = rowPresentation(match.row, input.now);
  const cancelled = view.row.realtimeState === 'cancelled';
  return {
    state: 'matched', timeText: view.timeText, live: view.live, status: view.statusText, provenance: view.provenance,
    note: match.method === 'schedule' ? 'Corsa abbinata per linea e orario programmato' : undefined,
    tone: cancelled ? 'disruption' : view.live ? 'live' : view.row.gtt.realtime === 'stale' ? 'caution' : 'scheduled',
  };
}
