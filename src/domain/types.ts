export interface Coordinate { latitude: number; longitude: number }
export type TravelMode = 'walk' | 'bicycle' | 'car' | 'transit';
export type TransitTime = { kind: 'now' } | { kind: 'depart-at' | 'arrive-by'; date: string; time: string };
export interface PlaceFieldCorrection {
  field: 'phone'; originalValue: string; value: string; url: string; checkedAt: string; reason: string;
}
export interface Place {
  id: string; name: string; coordinate: Coordinate; category?: string | null; address?: string | null;
  website?: string | null; phone?: string | null; source: string; attributions: string[];
  dataUpdatedAt?: string; confidence?: number | null; operatingStatus?: string | null; distanceMeters?: number;
  fieldCorrections?: PlaceFieldCorrection[];
}
export type SavedPlace = Place;
export interface RouteStep { instruction: string; distanceMeters: number; coordinate?: Coordinate }
export interface RouteStop {
  id: string; name: string; code?: string; coordinate?: Coordinate; platformCode?: string;
}
export interface RouteLeg {
  id: string; mode: string; line?: string; headsign?: string; from: string; to: string;
  fromStop?: RouteStop; toStop?: RouteStop; tripId?: string; serviceDate?: string;
  transitLeg: boolean; interlineWithPreviousLeg: boolean;
  timingStatus: 'scheduled' | 'prediction' | 'cancelled' | 'unknown';
  durationSeconds: number; distanceMeters: number; departureAt?: number; arrivalAt?: number;
  realTime: boolean; geometry: Coordinate[]; steps: RouteStep[];
}
export interface RoutePlan {
  id: string; mode: TravelMode; distanceMeters: number; durationSeconds: number;
  departureAt?: number; arrivalAt?: number;
  walkingDurationSeconds: number; walkingDistanceMeters: number; waitingDurationSeconds: number; transferCount: number;
  geometry: Coordinate[]; legs: RouteLeg[]; source: string; warnings: string[]; fetchedAt: number;
}
export interface Stop { id: string; code: string; name: string; coordinate: Coordinate; lines: string[]; distanceMeters?: number }
export interface Departure {
  id: string; stopId: string; line: string; headsign: string; expectedAt?: number; scheduledAt?: number;
  status: 'live' | 'scheduled' | 'stale' | 'cancelled' | 'unknown'; sourceUpdatedAt?: number; source: string;
}
export interface DepartureBoard { departures: Departure[]; fetchedAt: number; sourceUpdatedAt?: number; warnings: string[]; source: string }
export type SearchPolicy = 'local-only' | 'local-and-online';
export interface SearchOptions { center: Coordinate; signal?: AbortSignal; policy?: SearchPolicy }
/** Coverage of the local package only; it never describes Photon coverage or completeness. */
export interface PlaceCoverage {
  bounds: [number, number, number, number];
  centerInside: boolean;
  radiusMeters: number | null;
  extent: 'contained' | 'partial' | 'outside' | 'package';
}
export interface SearchResult {
  places: Place[]; warnings: string[]; source: string;
  coverage: PlaceCoverage; resultLimit: number; truncated: boolean;
}
export interface TransitAlert { id: string; title: string; description: string; url?: string; source: string }
export interface TransitAlertSnapshot { alerts: TransitAlert[]; fetchedAt: number; sourceUpdatedAt?: number; source: string; warnings: string[] }

/**
 * Provider-neutral stop/station board model shared by online transit providers.
 * Each row carries its own provider, retrieval time and (only when the provider supplies one)
 * source update time. Never derive `sourceUpdatedAt` from the retrieval time.
 */
export type TransitBoardProvider = 'transitous' | 'gtt';
export type TransitRealtimeState =
  /** Realtime prediction with a provider-supplied source timestamp in `sourceUpdatedAt`. */
  | 'realtime-with-source-time'
  /** The provider flags the time as realtime but supplies no source timestamp. */
  | 'declared-realtime-no-source-time'
  /** Timetable time; the provider states it has no realtime data for this event. */
  | 'scheduled'
  /** The provider reports this event or the entire trip as cancelled. */
  | 'cancelled'
  /** Missing, contradictory or inconsistent realtime information. */
  | 'unknown';
/** How the provider says the shown time was obtained, kept separately from the board state. */
export type TransitTimeBasis = 'observed' | 'predicted' | 'propagated' | 'scheduled' | 'inconsistent' | 'unknown';
export type TransitBoardMode =
  | 'tram' | 'bus' | 'metro' | 'rail-suburban' | 'rail-regional' | 'rail-long-distance' | 'rail-high-speed'
  | 'rail-night' | 'rail' | 'coach' | 'ferry' | 'funicular' | 'aerial-lift' | 'other' | 'unknown';
export interface TransitUpstreamSource {
  /** Operator name as supplied by the provider (e.g. "TRENITALIA", "GTT Servizio Urbano"). */
  operator?: string;
  /** Required upstream attribution, only when the provider's dataset is known and verified. */
  attribution?: string;
  /** Provider-side dataset identifier, preserved for provenance (e.g. "it_trenitalia.gtfs.zip"). */
  dataset?: string;
}
export interface TransitPlatform {
  /** Platform from the static timetable, when supplied separately. */
  scheduled?: string;
  /** Platform as currently published; may or may not include realtime changes. */
  current?: string;
  /** True only when both values are supplied and differ. */
  changed: boolean;
}
export interface TransitBoardRow {
  id: string;
  provider: TransitBoardProvider;
  upstream: TransitUpstreamSource;
  event: 'departure' | 'arrival';
  mode: TransitBoardMode;
  /** Raw provider mode, preserved when `mode` is `unknown` or `other`. */
  providerMode?: string;
  /** Line or service category (e.g. "9", "SFM", "RV"). */
  line?: string;
  /** Train or trip number when distinct from the line (e.g. "26481"). */
  tripNumber?: string;
  /** Provider display label (e.g. "SFM 26481", "TGV INOUI 9255"). */
  displayName?: string;
  headsign?: string;
  /** Exact provider text when `headsign` was corrected for a verified encoding glitch. */
  headsignAsSupplied?: string;
  /** Final stop of the trip, when supplied; useful when the headsign is empty. */
  destination?: string;
  stop: { id: string; name: string };
  scheduledAt?: number;
  /** Realtime time, present only for realtime states. */
  predictedAt?: number;
  /** Time exactly as returned by the provider, even if it is not a confirmed prediction. */
  providerTimeAt?: number;
  timeBasis: TransitTimeBasis;
  realtimeState: TransitRealtimeState;
  /** True when the provider reports the whole trip cancelled (not just this stop). */
  tripCancelled: boolean;
  platform?: TransitPlatform;
  /** Provider trip reference for a trip-details request. Opaque. */
  tripRef?: string;
  retrievedAt: number;
  /** Only when supplied by the provider; never manufactured from `retrievedAt`. */
  sourceUpdatedAt?: number;
}
export interface TransitBoardSnapshot {
  provider: TransitBoardProvider;
  event: 'departure' | 'arrival';
  stop: { id: string; name: string; coordinate?: Coordinate };
  rows: TransitBoardRow[];
  retrievedAt: number;
  /** Earliest time a manual refresh issues a new request; earlier refreshes return this snapshot. */
  nextRefreshAt: number;
  /** Upstream attributions for the rows shown, plus the provider-level sources link. */
  attributions: string[];
  sourcesUrl?: string;
  warnings: string[];
}
export interface TransitTripStop {
  stopId: string; name: string; nameAsSupplied?: string; coordinate?: Coordinate;
  scheduledArrivalAt?: number; scheduledDepartureAt?: number;
  predictedArrivalAt?: number; predictedDepartureAt?: number;
  arrivalBasis: TransitTimeBasis; departureBasis: TransitTimeBasis;
  cancelled: boolean; platform?: TransitPlatform;
}
export interface TransitTripDetails {
  provider: TransitBoardProvider; tripRef: string; upstream: TransitUpstreamSource;
  mode: TransitBoardMode; providerMode?: string; line?: string; tripNumber?: string; displayName?: string;
  headsign?: string; headsignAsSupplied?: string;
  realtimeState: TransitRealtimeState; tripCancelled: boolean;
  stops: TransitTripStop[];
  retrievedAt: number; nextRefreshAt: number; sourceUpdatedAt?: number;
  attributions: string[]; sourcesUrl?: string; warnings: string[];
}
