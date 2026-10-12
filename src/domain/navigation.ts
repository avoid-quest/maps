import type { Coordinate, RoutePlan, TravelMode } from './types';

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
  problem?: 'location-permission' | 'location-disabled' | 'location-stale' | 'location-inaccurate' | 'route-unavailable' | 'rate-limit' | 'reroute-limit' | 'native-error' | 'transit-replan-needed' | 'engine-unavailable' | 'service-unavailable';
  transit?: {
    phase: 'walk' | 'board' | 'ride' | 'alight' | 'transfer' | 'complete';
    legIndex: number; legCount: number; line?: string; headsign?: string; from?: string; to?: string;
    departureAt?: number; arrivalAt?: number; timingStatus: 'scheduled' | 'prediction' | 'cancelled' | 'unknown'; fetchedAt: number;
    canConfirmWalking: boolean; canConfirmBoarding: boolean; canConfirmAlighting: boolean;
    sourceLegIndices?: number[]; proximityAvailable?: boolean;
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
  voice: 'unavailable', notificationGranted: false, canRetry: false,
};
export function navigationVisible(snapshot: NavigationSnapshot): boolean {
  return snapshot.status !== 'idle' && snapshot.status !== 'stopped';
}
/** A retained dot is not a usable origin after the native session reports a lost or poor fix. */
export function navigationLocationForReplan(snapshot: NavigationSnapshot, now = Date.now()): Coordinate | null {
  const location = snapshot.location;
  if (!location || snapshot.status === 'location-degraded'
    || (snapshot.problem && snapshot.problem !== 'transit-replan-needed')) return null;
  const age = now - location.timestamp;
  if (!Number.isFinite(age) || age < 0 || age > 10_000
    || !Number.isFinite(location.accuracyMeters) || location.accuracyMeters <= 0 || location.accuracyMeters > 35
    || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90
    || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) return null;
  return { latitude: location.latitude, longitude: location.longitude };
}
