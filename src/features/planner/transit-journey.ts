import type { NavigationStart, RoadMode, TransitNavigationStart } from '../../domain/navigation';
import type { Coordinate, RouteIntermediateStop, RouteLeg, RoutePlan, RouteStop, Stop, TravelMode } from '../../domain/types';
import { transitModeFromLeg, type TransitMode } from '../../ui/transit-line';
import { journeyDate, journeyDistance, journeyDuration, journeyTime, waitBefore } from './journey-presentation';

/**
 * Transit alternatives and the selected journey's timeline, derived from the MATO plan alone so the
 * wording is unit-testable. Colour tones follow the brand: `live` is reserved for realtime with a
 * source timestamp (MATO supplies none, so planner rows never use it), `caution` for unconfirmed or
 * passed times and `disruption` for cancellations. Every tone also has its words.
 */
export type TimingTone = 'neutral' | 'scheduled' | 'caution' | 'disruption';
/** Planner times older than this are labelled for refresh. */
export const PLAN_FRESH_MS = 120_000;
/** Provider times are minute-granular: a time counts as passed one minute after it. */
const PASSED_GRACE_MS = 60_000;

export type AlternativeSegment =
  | { kind: 'line'; key: string; line?: string; mode?: TransitMode; label: string }
  /** Between two boardings: a change, on foot when the plan walks between them. */
  | { kind: 'change'; key: string; walk: boolean }
  /** The provider's same-vehicle flag: the line continues without a change. */
  | { kind: 'stay'; key: string };

export interface AlternativeRow {
  id: string;
  departure: string;
  arrival: string;
  /** "del 3 nov 2026" when the journey ends on another day. */
  arrivalDay?: string;
  duration: string;
  segments: AlternativeSegment[];
  walking: string;
  changes: string;
  confidence: { tone: TimingTone; label: string };
  accessibilityLabel: string;
}

export function legLabel(leg: RouteLeg): string {
  return leg.transitLeg ? (leg.line ? `Linea ${leg.line}` : 'Mezzo pubblico') : leg.mode === 'walk' ? 'A piedi' : leg.mode === 'bicycle' ? 'In bici' : leg.mode === 'car' ? 'In auto' : 'Tratta';
}
const transitLegs = (plan: RoutePlan) => plan.legs.filter(leg => leg.transitLeg);

export function changesLabel(plan: RoutePlan): string {
  if (!transitLegs(plan).length) return plan.legs.every(leg => leg.mode === 'walk') ? 'Solo a piedi' : 'Senza mezzi pubblici';
  return plan.transferCount === 0 ? 'Nessun cambio' : `${plan.transferCount} ${plan.transferCount === 1 ? 'cambio' : 'cambi'}`;
}

export function walkingLabel(plan: RoutePlan): string {
  if (plan.walkingDurationSeconds <= 0 && plan.walkingDistanceMeters <= 0) return 'Senza tratti a piedi';
  return `A piedi ${journeyDuration(plan.walkingDurationSeconds)} · ${journeyDistance(plan.walkingDistanceMeters)}`;
}

/** Line badges in boarding order, with change and same-vehicle markers between them. */
export function alternativeSegments(plan: RoutePlan): AlternativeSegment[] {
  const segments: AlternativeSegment[] = [];
  let walkedSinceAlighting = false;
  let seenTransit = false;
  for (const leg of plan.legs) {
    if (!leg.transitLeg) { if (seenTransit) walkedSinceAlighting ||= leg.mode === 'walk' && leg.distanceMeters > 0; continue; }
    if (seenTransit) segments.push(leg.interlineWithPreviousLeg ? { kind: 'stay', key: `stay:${leg.id}` } : { kind: 'change', key: `change:${leg.id}`, walk: walkedSinceAlighting });
    segments.push({ kind: 'line', key: leg.id, line: leg.line, mode: transitModeFromLeg(leg.mode), label: legLabel(leg) });
    seenTransit = true;
    walkedSinceAlighting = false;
  }
  return segments;
}

/**
 * One word-labelled confidence per alternative, most severe first: a cancellation, a first boarding
 * already passed, an unknown timing state, then the timetable/prediction mix.
 */
export function alternativeConfidence(plan: RoutePlan, now: number): AlternativeRow['confidence'] {
  const legs = transitLegs(plan);
  if (!legs.length) return { tone: 'neutral', label: 'Solo a piedi' };
  if (legs.some(leg => leg.timingStatus === 'cancelled')) return { tone: 'disruption', label: 'Corsa cancellata' };
  const first = legs[0]!;
  if (first.departureAt != null && first.departureAt < now - PASSED_GRACE_MS) return { tone: 'caution', label: 'Partenza già passata' };
  if (legs.some(leg => leg.timingStatus === 'unknown')) return { tone: 'caution', label: 'Orario non confermato' };
  const predicted = legs.filter(leg => leg.timingStatus === 'prediction').length;
  if (predicted === legs.length) return { tone: 'neutral', label: 'Previsione MATO' };
  if (predicted > 0) return { tone: 'scheduled', label: 'In parte programmato' };
  return { tone: 'scheduled', label: 'Orari programmati' };
}

export function alternativeRow(plan: RoutePlan, now: number, index = 0): AlternativeRow {
  const departure = journeyTime(plan.departureAt);
  const arrival = journeyTime(plan.arrivalAt);
  const overnight = plan.departureAt != null && plan.arrivalAt != null && journeyDate(plan.departureAt) !== journeyDate(plan.arrivalAt);
  const segments = alternativeSegments(plan);
  const confidence = alternativeConfidence(plan, now);
  const duration = journeyDuration(plan.durationSeconds);
  const walking = walkingLabel(plan);
  const changes = changesLabel(plan);
  const lines = segments.filter((item): item is Extract<AlternativeSegment, { kind: 'line' }> => item.kind === 'line').map(item => item.label);
  return {
    id: plan.id, departure, arrival, ...(overnight ? { arrivalDay: `del ${journeyDate(plan.arrivalAt!)}` } : {}), duration, segments, walking, changes, confidence,
    accessibilityLabel: `Alternativa ${index + 1}: partenza ${departure}, arrivo ${arrival}${overnight ? ` del ${journeyDate(plan.arrivalAt!)}` : ''}, ${duration}, ${lines.length ? lines.join(', poi ') : 'a piedi'}, ${changes}, ${walking}, ${confidence.label}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Selected journey timeline

export interface TimelineTime {
  /** The time the plan expects (a prediction when MATO supplies one). */
  time: string;
  /** Timetable time, only when a supplied delay moves the expected time by a minute or more. */
  scheduled?: string;
  provenance: string;
  tone: TimingTone;
}
export interface TimelineStop {
  name: string;
  code?: string;
  platform?: string;
  /** A GTT stop validated by the strict journey-stop matcher; opens its board. */
  board: Stop | null;
}
export type WalkRole = 'access' | 'transfer' | 'egress' | 'only';
export type TimelineItem =
  | { kind: 'walk'; key: string; role: WalkRole; title: string; detail: string; legIndex: number }
  | { kind: 'wait'; key: string; title: string; legIndex: number }
  | { kind: 'board'; key: string; legIndex: number; line?: string; mode?: TransitMode; lineLabel: string; direction: string; stop: TimelineStop; at: TimelineTime; title: string; cancelled: boolean }
  | { kind: 'ride'; key: string; legIndex: number; duration: string; stops: RouteIntermediateStop[] | null; summary: string }
  | { kind: 'alight'; key: string; legIndex: number; stop: TimelineStop; at: TimelineTime; title: string }
  | { kind: 'arrive'; key: string; name: string; time: string };

/** Planner provenance for one leg: predictions keep the missing source update explicit. */
export function legProvenance(leg: RouteLeg, stale: boolean): { label: string; tone: TimingTone } {
  if (leg.timingStatus === 'cancelled') return { label: 'Corsa cancellata', tone: 'disruption' };
  if (leg.timingStatus === 'scheduled') return { label: 'Orario programmato', tone: 'scheduled' };
  if (leg.timingStatus === 'unknown') return { label: 'Stato dell’orario non disponibile', tone: 'caution' };
  return stale ? { label: 'Previsione MATO da aggiornare', tone: 'caution' } : { label: 'Previsione MATO', tone: 'neutral' };
}

function timelineTime(expected: number | undefined, scheduled: number | undefined, leg: RouteLeg, stale: boolean): TimelineTime {
  const provenance = legProvenance(leg, stale);
  const moved = scheduled != null && expected != null && Math.abs(expected - scheduled) >= 60_000 && journeyTime(expected) !== journeyTime(scheduled);
  return { time: journeyTime(expected), ...(moved ? { scheduled: journeyTime(scheduled) } : {}), provenance: provenance.label, tone: provenance.tone };
}

function timelineStop(stop: RouteStop | undefined, fallback: string, match: (stop: RouteStop | undefined) => Stop | null): TimelineStop {
  return {
    name: stop?.name ?? fallback,
    ...(stop?.code ? { code: stop.code } : {}),
    ...(stop?.platformCode ? { platform: stop.platformCode } : {}),
    board: match(stop),
  };
}

export function walkRole(plan: RoutePlan, index: number): WalkRole {
  const before = plan.legs.slice(0, index).some(leg => leg.transitLeg);
  const after = plan.legs.slice(index + 1).some(leg => leg.transitLeg);
  return before && after ? 'transfer' : after ? 'access' : before ? 'egress' : 'only';
}

const walkTitles: Record<WalkRole, string> = {
  access: 'A piedi fino alla fermata', transfer: 'Cambio a piedi', egress: 'A piedi fino alla destinazione', only: 'A piedi fino alla destinazione',
};

/** Intermediate stops as supplied; a leg without them says so instead of guessing a count. */
export function rideSummary(leg: RouteLeg): string {
  const stops = leg.intermediateStops;
  if (!stops) return 'Fermate intermedie non disponibili';
  if (!stops.length) return 'Nessuna fermata intermedia indicata';
  return `${stops.length} ${stops.length === 1 ? 'fermata intermedia' : 'fermate intermedie'}`;
}

/**
 * Access walk → board → ride → alight → transfer walk … → arrive. `match` is the strict GTT stop
 * matcher, so only validated stop endpoints link to their boards.
 */
export function journeyTimeline(plan: RoutePlan, options: { now: number; stale?: boolean; destination?: string; match: (stop: RouteStop | undefined) => Stop | null }): TimelineItem[] {
  const stale = options.stale || options.now - plan.fetchedAt > PLAN_FRESH_MS;
  const items: TimelineItem[] = [];
  plan.legs.forEach((leg, index) => {
    const previous = plan.legs[index - 1];
    const next = plan.legs[index + 1];
    const wait = waitBefore(leg, previous);
    if (wait >= 60 && leg.transitLeg) {
      items.push({ kind: 'wait', key: `wait:${leg.id}`, legIndex: index, title: `${leg.interlineWithPreviousLeg ? 'Sosta a bordo' : 'Attesa'} ${journeyDuration(wait)}` });
    }
    if (!leg.transitLeg) {
      const role = walkRole(plan, index);
      const mode = leg.mode === 'walk' ? walkTitles[role] : legLabel(leg);
      items.push({ kind: 'walk', key: `walk:${leg.id}`, legIndex: index, role, title: mode, detail: `${journeyDuration(leg.durationSeconds)} · ${journeyDistance(leg.distanceMeters)}` });
      return;
    }
    const cancelled = leg.timingStatus === 'cancelled';
    if (!leg.interlineWithPreviousLeg) {
      items.push({
        kind: 'board', key: `board:${leg.id}`, legIndex: index, line: leg.line, mode: transitModeFromLeg(leg.mode), lineLabel: legLabel(leg),
        direction: leg.headsign ? `Direzione ${leg.headsign}` : 'Direzione non fornita dal servizio',
        stop: timelineStop(leg.fromStop, leg.from, options.match), at: timelineTime(leg.departureAt, leg.scheduledDepartureAt, leg, stale),
        title: cancelled ? 'Partenza cancellata' : 'Sali', cancelled,
      });
    }
    items.push({ kind: 'ride', key: `ride:${leg.id}`, legIndex: index, duration: journeyDuration(leg.durationSeconds), stops: leg.intermediateStops ?? null, summary: rideSummary(leg) });
    if (!next?.interlineWithPreviousLeg) {
      items.push({
        kind: 'alight', key: `alight:${leg.id}`, legIndex: index, stop: timelineStop(leg.toStop, leg.to, options.match),
        at: timelineTime(leg.arrivalAt, leg.scheduledArrivalAt, leg, stale), title: cancelled ? 'Arrivo programmato' : 'Scendi',
      });
    }
  });
  const last = plan.legs.at(-1);
  items.push({ kind: 'arrive', key: 'arrive', name: options.destination ?? (last?.to && last.to !== 'Destinazione' ? last.to : 'Destinazione'), time: journeyTime(plan.arrivalAt ?? last?.arrivalAt) });
  return items;
}

// ---------------------------------------------------------------------------------------------
// The planner's anchored primary action

export interface PrimaryActionInput {
  mode: TravelMode;
  route: RoutePlan | null;
  loading: boolean;
  retained: boolean;
  picking: boolean;
  /** The origin is awaiting a fresh fix: relevant to road guidance only. */
  originPending: boolean;
  originReady: boolean;
  supported: boolean;
  navigationReady: boolean;
  navigationBusy: boolean;
}
export interface PrimaryAction {
  kind: 'search' | 'follow' | 'start' | 'none';
  label: string;
  enabled: boolean;
  loading: boolean;
  /** Why the action is unavailable, shown beside it. */
  reason?: string;
}

export function followableJourney(plan: RoutePlan | null): plan is RoutePlan {
  return !!plan && plan.mode === 'transit' && plan.legs.some(leg => leg.transitLeg) && !plan.legs.some(leg => leg.timingStatus === 'cancelled');
}

/**
 * Mode-correct primary action. In Mezzi it searches until transit alternatives exist and then
 * follows the selected one ("Segui viaggio"); it never starts road guidance. Following needs no
 * position, so origin locating and background refreshes never disable it.
 */
export function plannerPrimaryAction(input: PrimaryActionInput): PrimaryAction {
  const { mode, route } = input;
  if (mode === 'transit') {
    const transitRoute = route?.mode === 'transit' ? route : null;
    if (!transitRoute) {
      return {
        kind: 'search', label: 'Cerca percorsi', loading: input.loading,
        enabled: input.originReady && !input.picking && !input.loading,
        ...(!input.originReady || input.picking ? { reason: 'Scegli la partenza' } : {}),
      };
    }
    if (!input.supported) return { kind: 'none', label: 'Segui viaggio', enabled: false, loading: false, reason: 'Segui il viaggio dall’app Android' };
    const reason = input.retained ? 'Scegli un’alternativa aggiornata'
      : transitRoute.legs.some(leg => leg.timingStatus === 'cancelled') ? 'Include una corsa cancellata'
        : !transitRoute.legs.some(leg => leg.transitLeg) ? 'Alternativa solo a piedi'
          : input.picking ? 'Scegli la partenza'
            : !input.navigationReady ? 'Navigazione non pronta' : undefined;
    return { kind: 'follow', label: 'Segui viaggio', enabled: !reason && !input.navigationBusy, loading: input.navigationBusy, ...(reason ? { reason } : {}) };
  }
  if (!input.supported) return { kind: 'none', label: 'Avvia', enabled: false, loading: false };
  const roadRoute = route?.mode === mode ? route : null;
  return {
    kind: 'start', label: 'Avvia', loading: false,
    enabled: !!roadRoute && input.navigationReady && !input.loading && !input.retained && !input.picking && !input.originPending && !input.navigationBusy,
  };
}

/**
 * The Start request for the plan on screen, or null when it does not belong to the selected mode:
 * Mezzi follows a transit journey and never starts road guidance.
 */
export function guidanceStart(mode: TravelMode, route: RoutePlan | null, retained: boolean, endpoints: { origin: Coordinate; destination: Coordinate } | null):
  | { kind: 'transit'; options: TransitNavigationStart } | { kind: 'road'; options: NavigationStart } | null {
  if (!route || retained || !endpoints) return null;
  if (mode === 'transit') return followableJourney(route) ? { kind: 'transit', options: { plan: route, origin: endpoints.origin, destination: endpoints.destination } } : null;
  return route.mode === mode ? { kind: 'road', options: { destination: endpoints.destination, mode: mode as RoadMode } } : null;
}
