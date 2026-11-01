import type { Coordinate, RoutePlan, TravelMode } from './types';
import fixPolicy from '../../modules/avoid-navigation/android/src/main/assets/road-guidance-policy.json';

/** Same packaged policy as native fix admission; a replanning origin must meet the walking start bound. */
export const navigationFixPolicy = {
  maximumFixAgeMillis: fixPolicy.maximumFixAgeMillis,
  originAccuracyMeters: fixPolicy.walk.startAccuracyMeters,
} as const;

export type RoadMode = 'walk' | 'bicycle' | 'car';
export type NavigationStatus = 'idle' | 'waiting-for-fix' | 'routing' | 'navigating' | 'location-degraded' | 'off-route' | 'rerouting' | 'arrived' | 'stopped' | 'interrupted' | 'error';
export interface NavigationSnapshot {
  revision: number;
  sessionId: string | null;
  status: NavigationStatus;
  mode: TravelMode | null;
  destination?: Coordinate;
  voice: 'initializing' | 'ready' | 'muted' | 'unavailable';
  notificationGranted: boolean;
  /** Independent of retained route/admission errors: only a current accepted fix is usable. */
  locationUsable?: boolean;
  location?: Coordinate & { accuracyMeters: number; bearing?: number; timestamp: number };
  instruction?: string;
  nextInstruction?: string;
  distanceToManeuverMeters?: number;
  distanceRemainingMeters?: number;
  durationRemainingSeconds?: number;
  destinationDistanceMeters?: number;
  routeRevision?: number;
  /** Events omit an unchanged route; null or a terminal session clears it. Reads include the full route. */
  route?: { geometry: Coordinate[]; source: string; fetchedAt: number } | null;
  problem?: 'location-permission' | 'location-disabled' | 'location-stale' | 'location-inaccurate' | 'location-unavailable'
    | 'route-unavailable' | 'route-invalid' | 'route-network' | 'route-timeout' | 'route-not-started' | 'rate-limit' | 'reroute-limit'
    | 'native-error' | 'transit-replan-needed' | 'engine-unavailable' | 'service-unavailable';
  /** Wall-clock start of the current position wait (road modes). */
  waitingSinceMs?: number;
  /** Latest received fix, accepted or not: accuracy and provider only, never coordinates. */
  lastFixAccuracyMeters?: number;
  fixProvider?: 'gps' | 'fused' | 'network' | 'other';
  /** Accuracy the session currently needs (start bound while waiting, guidance bound afterwards). */
  requiredAccuracyMeters?: number;
  /** Set once the start wait settled without a usable fix; Retry and Stop stay available. */
  startTimedOut?: boolean;
  bestRejectedAccuracyMeters?: number;
  /** Walking started from a fix outside the normal start bound; shown, never hidden. */
  reducedAccuracyStartMeters?: number;
  /** Latest accepted guidance fix is worse than the mode's normal accuracy (guidance continues up to 50 m). */
  reducedPrecisionMeters?: number;
  transit?: {
    phase: 'walk' | 'board' | 'ride' | 'alight' | 'transfer' | 'complete';
    legIndex: number; legCount: number; line?: string; headsign?: string; from?: string; to?: string;
    departureAt?: number; arrivalAt?: number; timingStatus: 'scheduled' | 'prediction' | 'cancelled' | 'unknown'; fetchedAt: number;
    canConfirmWalking: boolean; canConfirmBoarding: boolean; canConfirmAlighting: boolean;
    sourceLegIndices?: number[]; proximityAvailable?: boolean;
    /** Planned end of the whole journey and the next boarding still ahead (while aboard: the next connection). */
    journeyArrivalAt?: number; nextBoardingAt?: number;
    confirmation?: TransitConfirmation;
  };
  canRetry: boolean;
}
export interface NavigationStart { destination: Coordinate; mode: RoadMode }
export interface TransitNavigationStart { plan: RoutePlan; origin: Coordinate; destination: Coordinate }
export type TransitConfirmation = 'board' | 'alight' | 'walk-complete';
/** Native owns the session; attaching the interface never starts positioning or routing. */
export interface NavigationPlatform {
  supported: boolean;
  prepareStart(): Promise<void>;
  startNavigation(options: NavigationStart): Promise<NavigationSnapshot>;
  startTransitNavigation(options: TransitNavigationStart): Promise<NavigationSnapshot>;
  confirmTransitStep(sessionId: string, action: TransitConfirmation): Promise<NavigationSnapshot>;
  stopNavigation(sessionId: string | null): Promise<NavigationSnapshot>;
  retryNavigation(sessionId: string): Promise<NavigationSnapshot>;
  setMuted(sessionId: string, muted: boolean): Promise<NavigationSnapshot>;
  getSnapshot(): Promise<NavigationSnapshot>;
  subscribe(listener: (snapshot: NavigationSnapshot) => void): () => void;
}
export const idleNavigation: NavigationSnapshot = {
  revision: 0, sessionId: null, status: 'idle', mode: null,
  voice: 'unavailable', notificationGranted: false, locationUsable: false, canRetry: false,
};
export function navigationVisible(snapshot: NavigationSnapshot): boolean {
  return snapshot.status !== 'idle' && snapshot.status !== 'stopped';
}
/** A retained dot is not a usable origin after the native session reports a lost or poor fix. */
export function navigationLocationForReplan(snapshot: NavigationSnapshot, now = Date.now()): Coordinate | null {
  const location = snapshot.location;
  if (!location || snapshot.locationUsable !== true || snapshot.status === 'location-degraded'
    || (snapshot.problem && snapshot.problem !== 'transit-replan-needed')) return null;
  const age = now - location.timestamp;
  if (!Number.isFinite(age) || age < 0 || age > navigationFixPolicy.maximumFixAgeMillis
    || !Number.isFinite(location.accuracyMeters) || location.accuracyMeters <= 0 || location.accuracyMeters > navigationFixPolicy.originAccuracyMeters
    || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90
    || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) return null;
  return { latitude: location.latitude, longitude: location.longitude };
}

const statuses: Record<NavigationStatus, string> = {
  idle: 'Preparazione', 'waiting-for-fix': 'Ricerca della posizione precisa', routing: 'Calcolo dalla tua posizione',
  navigating: 'Navigazione', 'location-degraded': 'Posizione da ritrovare', 'off-route': 'Fuori percorso', rerouting: 'Ricalcolo del percorso',
  arrived: 'Sei arrivato', stopped: 'Navigazione terminata', interrupted: 'Navigazione interrotta', error: 'Navigazione non disponibile',
};
const problems: Record<NonNullable<NavigationSnapshot['problem']>, string> = {
  'location-permission': 'La posizione precisa non è autorizzata. Abilitala nelle impostazioni dell’app.',
  'location-disabled': 'La posizione del dispositivo è disattivata. Riattivala per proseguire.',
  'location-stale': 'Posizione non aggiornata.',
  'location-inaccurate': 'Posizione poco precisa.',
  'location-unavailable': 'Nessuna posizione ricevuta. Spostati all’aperto, controlla che la posizione sia attiva e riprova.',
  'route-unavailable': 'Servizio di percorso non disponibile. Riprova più tardi.',
  'route-invalid': 'Il percorso ricevuto non è utilizzabile. Riprova.',
  'route-network': 'Percorso non calcolato: connessione assente. Controlla la rete e riprova.',
  'route-timeout': 'Il servizio di percorso non ha risposto in tempo. Riprova.',
  'route-not-started': 'Il percorso ricevuto non può essere seguito. Riprova.',
  'rate-limit': 'Troppe richieste. Riprova più tardi.',
  'reroute-limit': 'Ricalcolo automatico sospeso. Controlla la posizione e riprova.',
  'native-error': 'La navigazione si è interrotta. Riprova dalla tua posizione attuale.',
  'transit-replan-needed': 'Viaggio da aggiornare. Scegli un nuovo percorso.',
  'engine-unavailable': 'Il motore di navigazione non è disponibile. Interrompi la sessione e riapri l’app.',
  'service-unavailable': 'Android non ha avviato il servizio di navigazione. Mantieni l’app visibile e riprova.',
};
const meters = (value: number) => value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1).replace('.', ',')} km`;
const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};
/** Grace before a planned time counts as passed; provider times are minute-granular. */
const TRANSIT_TIME_GRACE_MS = 60_000;

export interface NavigationPresentation {
  header: string; instruction: string; quality: string;
  /** Elapsed wait and current vs required accuracy; accuracy only, never coordinates. */
  signal: string | null;
  /** Reduced-start or reduced-precision label while guidance continues. */
  precision: string | null;
  /** Expired journey or missed boarding: shown at once with a replanning action. */
  transitWarning: string | null;
  guiding: boolean; paused: boolean; searching: boolean; terminal: boolean;
}

/** All navigation panel wording, derived from the native snapshot alone so it is unit-testable. */
/** [starting]: a Start command is in flight (permission prompt, service promotion) before any session snapshot. */
export function navigationPresentation(snapshot: NavigationSnapshot, now: number, arrival: string | null = null, starting = false): NavigationPresentation {
  const terminal = snapshot.status === 'arrived' || snapshot.status === 'interrupted' || snapshot.status === 'error';
  const transitMode = snapshot.mode === 'transit';
  const cues = snapshot.locationUsable === true;
  // Manual transit following does not need GPS; only its advisory proximity cues do.
  const guiding = snapshot.status === 'navigating' && (transitMode || snapshot.locationUsable !== false);
  const paused = !guiding && !terminal;
  const neverLocated = !snapshot.location;
  const notFound = !transitMode && !terminal && (snapshot.startTimedOut === true || (snapshot.status === 'location-degraded' && neverLocated));
  const searching = !transitMode && !terminal && (snapshot.status === 'waiting-for-fix' || notFound);
  const required = snapshot.requiredAccuracyMeters;
  const accuracy = snapshot.lastFixAccuracyMeters;
  const needs = required != null ? `, serve ±${Math.round(required)} m` : '';
  const current = accuracy != null ? `Segnale ±${Math.round(accuracy)} m${needs}` : 'Nessun segnale ricevuto';

  let header: string;
  if (paused && snapshot.instruction) header = 'Guida in pausa · Ultima indicazione';
  else if (guiding && !transitMode && snapshot.distanceToManeuverMeters != null) header = `Tra ${meters(snapshot.distanceToManeuverMeters)}`;
  else if (notFound) header = 'Posizione non trovata';
  else if (transitMode && snapshot.status === 'waiting-for-fix') header = 'Avvio del viaggio';
  else header = statuses[snapshot.status];

  // Routing already has an accepted fix: only the position wait (or a Start in flight) asks to wait for it.
  const fallback = notFound ? 'Riprova o interrompi la navigazione'
    : snapshot.status === 'waiting-for-fix' || (starting && snapshot.status === 'idle') ? 'Attendi la posizione precisa'
      : snapshot.status === 'routing' ? 'Calcolo del percorso in corso'
        : snapshot.status === 'rerouting' ? 'Ricalcolo del percorso in corso' : 'In attesa di indicazioni';
  const instruction = terminal ? (snapshot.status === 'arrived' && snapshot.instruction ? snapshot.instruction : statuses[snapshot.status])
    : snapshot.instruction ?? fallback;

  let quality: string;
  const best = snapshot.bestRejectedAccuracyMeters ?? accuracy;
  if (notFound && snapshot.problem === 'location-inaccurate' && best != null) {
    quality = `Segnale troppo debole ±${Math.round(best)} m${required != null ? ` (serve ±${Math.round(required)} m)` : ''}. Spostati all’aperto e riprova.`;
  } else if (notFound && (snapshot.problem === 'location-unavailable' || snapshot.problem == null || (neverLocated && snapshot.problem === 'location-stale'))) {
    quality = 'Posizione non trovata: nessun segnale ricevuto. Spostati all’aperto, controlla che la posizione sia attiva e riprova.';
  } else if (snapshot.problem) quality = problems[snapshot.problem];
  else if (guiding) quality = arrival ? `Arrivo stimato ${arrival}` : transitMode && !cues ? 'Segui il viaggio e conferma ogni passaggio' : 'Posizione valida';
  else quality = header;

  let signal: string | null = null;
  if (searching) signal = `${snapshot.waitingSinceMs != null ? `Ricerca da ${elapsed(now - snapshot.waitingSinceMs)} · ` : ''}${current}`;
  else if (paused && !transitMode && accuracy != null) signal = current;

  const reduced = snapshot.reducedPrecisionMeters ?? snapshot.reducedAccuracyStartMeters;
  const precision = terminal || reduced == null ? null
    : `${snapshot.reducedAccuracyStartMeters != null ? 'Avvio con precisione ridotta' : 'Precisione ridotta'} ±${Math.round(reduced)} m`;

  let transitWarning: string | null = null;
  const transit = snapshot.transit;
  if (transit && !terminal) {
    if (transit.journeyArrivalAt != null && transit.journeyArrivalAt < now - TRANSIT_TIME_GRACE_MS) {
      transitWarning = 'L’orario di questo viaggio è già concluso: le indicazioni potrebbero non essere più valide. Aggiorna il viaggio.';
    } else {
      const boarding = transit.nextBoardingAt ?? (transit.phase === 'board' ? transit.departureAt : undefined);
      if (boarding != null && boarding < now - TRANSIT_TIME_GRACE_MS) transitWarning = 'La corsa prevista è già partita. Aggiorna il viaggio per una nuova partenza.';
    }
  }
  return { header, instruction, quality, signal, precision, transitWarning, guiding, paused, searching, terminal };
}
