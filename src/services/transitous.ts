import type {
  Coordinate, Stop, TransitBoardMode, TransitBoardRow, TransitBoardSnapshot, TransitPlatform, TransitRealtimeState,
  TransitTimeBasis, TransitTripDetails, TransitTripStop, TransitUpstreamSource,
} from '../domain/types';
import { distanceMeters, validCoordinate } from './geo';
import { checkAbort, fetchJSON, parseServiceData, requestQueue, ServiceError } from './network';
import type { RailPilotStation } from './transitous-stations';

/**
 * Transitous (MOTIS 2) client. Policy, verified 2026-11-01 at https://transitous.org/api/ :
 * open-source non-commercial use, identifying User-Agent (name, version, contact), a visible link to
 * https://transitous.org/sources/ , and coordination above ~720 /plan-type requests per day (not used here).
 *
 * Privacy: every request sends only the identifier the user selected (stop, station, trip or typed text)
 * plus fixed parameters identical for every user. No device location, no language or device headers.
 * Requests are issued only by explicit calls; nothing here polls.
 */
export const TRANSITOUS_API = 'https://api.transitous.org';
export const TRANSITOUS_SOURCES_URL = 'https://transitous.org/sources/';
export const TRANSITOUS_PRIVACY_URL = 'https://transitous.org/privacy/';
export const TRANSITOUS_CONTACT_URL = 'https://github.com/avoid-quest/maps';
/** Manual refreshes inside this window return the cached snapshot instead of a new request. */
export const TRANSITOUS_MIN_REFRESH_MS = 60_000;
const LOOKUP_CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 24;
const REQUEST_SPACING_MS = 1_000;
const RAIL_BOARD_SIZE = 12;
const STOP_BOARD_SIZE = 10;
/** A response stop farther than this from the bundled coordinate is treated as a failed join. */
const STOP_MATCH_METERS = 150;
const STATION_MATCH_METERS = 300;
/** Fixed Turin-region box sent with name searches; identical for every user and never the device position. */
const TURIN_REGION = { min: '44.9,7.4', max: '45.3,7.95' } as const;
const GTT_DATASET_PREFIX = 'it-Piemonte-Gruppo-Torinese-Trasporti_';

/** Accurate disclosure strings for the UI. Keep in sync with the parameters each request sends. */
export const TRANSITOUS_PRIVACY_NOTES = {
  stopFallback: 'Cerca su Transitous invia a Transitous (api.transitous.org) solo il codice della fermata selezionata, con parametri fissi uguali per tutti. La tua posizione non viene inviata. Come per ogni richiesta web, Transitous riceve anche indirizzo IP, ora e nome e versione dell’app e conserva questi log fino a 2 giorni. I risultati sostituiscono la fonte online GTT di questa bacheca.',
  railBoard: 'Le partenze dei treni sono richieste a Transitous (api.transitous.org) inviando solo il codice della stazione aperta. La tua posizione non viene inviata. Transitous riceve anche indirizzo IP, ora e nome e versione dell’app e conserva questi log fino a 2 giorni.',
  tripDetails: 'Le fermate della corsa sono richieste a Transitous (api.transitous.org) inviando solo il codice della corsa selezionata. La tua posizione non viene inviata.',
  stopSearch: 'La ricerca invia a Transitous (api.transitous.org) il testo digitato e un riquadro fisso dell’area di Torino. La tua posizione non viene inviata.',
} as const;

/** Upstream datasets whose attribution was verified on the Transitous sources page (2026-11-01). */
const KNOWN_DATASETS: Record<string, { attribution: string }> = {
  'it_trenitalia.gtfs.zip': { attribution: 'BusOne (https://busone.app) and Trenitalia' },
  'it_Piemonte-Gruppo-Torinese-Trasporti.gtfs.zip': { attribution: 'BusOne (https://busone.app) and GTT' },
};
const TRENITALIA_DATASET = 'it_trenitalia.gtfs.zip';
/**
 * Verified encoding glitches: Transitous publishes Ciriè station (it-trenitalia_00090, 45.2305 N 7.6017 E)
 * and the matching SFM headsign as "Ciri". Only exact whole-string matches within that dataset are corrected.
 */
const TRENITALIA_NAME_FIXES: Record<string, string> = { Ciri: 'Ciriè' };

export function transitousUserAgent(version: unknown): string {
  const safe = typeof version === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : 'unknown';
  return `AvoidMaps/${safe} (+${TRANSITOUS_CONTACT_URL})`;
}

export function transitousGttStopId(gttStopId: string): string {
  if (!/^[A-Za-z0-9-]{1,32}$/.test(gttStopId)) throw new ServiceError('Codice fermata non valido.', 'invalid');
  return `${GTT_DATASET_PREFIX}${gttStopId}`;
}

// ---------------------------------------------------------------------------------------------
// Defensive field readers: anything malformed becomes `undefined`, never a guessed value.

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const flag = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
function instant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function coordinateOf(place: JsonObject): Coordinate | undefined {
  const coordinate = { latitude: place.lat as number, longitude: place.lon as number };
  return typeof place.lat === 'number' && typeof place.lon === 'number' && validCoordinate(coordinate) ? coordinate : undefined;
}
function invalid(): never { throw new ServiceError('Transitous ha restituito dati non validi. Nessun orario mostrato.', 'invalid'); }

const MODES: Record<string, TransitBoardMode> = {
  TRAM: 'tram', BUS: 'bus', SUBWAY: 'metro', METRO: 'metro', SUBURBAN: 'rail-suburban',
  REGIONAL_RAIL: 'rail-regional', REGIONAL_FAST_RAIL: 'rail-regional', HIGHSPEED_RAIL: 'rail-high-speed',
  LONG_DISTANCE: 'rail-long-distance', NIGHT_RAIL: 'rail-night', RAIL: 'rail', COACH: 'coach', FERRY: 'ferry',
  FUNICULAR: 'funicular', AERIAL_LIFT: 'aerial-lift', AREAL_LIFT: 'aerial-lift', CABLE_CAR: 'aerial-lift', OTHER: 'other',
};
function modeOf(value: unknown): { mode: TransitBoardMode; providerMode?: string } {
  const raw = text(value);
  const mode = raw ? MODES[raw] : undefined;
  return mode && mode !== 'other' ? { mode } : { mode: mode ?? 'unknown', providerMode: raw };
}
const BASES: Record<string, TransitTimeBasis> = {
  OBSERVED: 'observed', PREDICTED: 'predicted', PROPAGATED: 'propagated', NO_RT_DATA: 'scheduled', INCONSISTENT_RT: 'inconsistent',
};
const isRealtimeBasis = (basis: TransitTimeBasis) => basis === 'observed' || basis === 'predicted' || basis === 'propagated';
function datasetOf(source: unknown): string | undefined {
  const raw = text(source);
  const file = raw?.split('/')[0];
  return file && /^[A-Za-z0-9_.-]{1,96}$/.test(file) ? file : undefined;
}
function upstreamOf(record: JsonObject): TransitUpstreamSource {
  const dataset = datasetOf(record.source);
  return { operator: text(record.agencyName), attribution: dataset ? KNOWN_DATASETS[dataset]?.attribution : undefined, dataset };
}
function fixName(name: string | undefined, dataset: string | undefined): { name?: string; asSupplied?: string } {
  if (!name || dataset !== TRENITALIA_DATASET) return { name };
  const fixed = TRENITALIA_NAME_FIXES[name];
  return fixed ? { name: fixed, asSupplied: name } : { name };
}
function platformOf(place: JsonObject): TransitPlatform | undefined {
  const scheduled = text(place.scheduledTrack); const current = text(place.track);
  if (!scheduled && !current) return undefined;
  return { scheduled, current, changed: !!scheduled && !!current && scheduled !== current };
}

/**
 * Classify one event. Transitous never supplies a source update timestamp, so realtime is at most
 * "declared"; contradictions between `realTime` and the timestamp reason become `unknown`.
 */
export function classifyEvent(input: { realTime: unknown; reason: unknown; cancelled: unknown; tripCancelled: unknown }): { state: TransitRealtimeState; basis: TransitTimeBasis } {
  const reason = text(input.reason);
  const basis: TransitTimeBasis = reason ? BASES[reason] ?? 'unknown' : 'unknown';
  if (input.cancelled === true || input.tripCancelled === true) return { state: 'cancelled', basis };
  const realTime = flag(input.realTime);
  if (reason && !BASES[reason]) return { state: 'unknown', basis };
  if (isRealtimeBasis(basis)) return { state: realTime === true ? 'declared-realtime-no-source-time' : 'unknown', basis };
  if (basis === 'scheduled') return { state: realTime === false ? 'scheduled' : 'unknown', basis };
  if (basis === 'inconsistent') return { state: 'unknown', basis };
  // Older servers omit the reason: rely on the boolean alone.
  if (realTime === true) return { state: 'declared-realtime-no-source-time', basis: 'unknown' };
  if (realTime === false) return { state: 'scheduled', basis: 'scheduled' };
  return { state: 'unknown', basis };
}

// ---------------------------------------------------------------------------------------------
// Pure parsers (exported for fixtures)

export interface ParsedStopTimes { stop: { id: string; name: string; code?: string; coordinate?: Coordinate }; rows: TransitBoardRow[]; dropped: number }

export function parseStopTimes(json: unknown, context: { event: 'departure' | 'arrival'; retrievedAt: number }): ParsedStopTimes {
  if (!isObject(json) || !Array.isArray(json.stopTimes) || !isObject(json.place)) invalid();
  const place = json.place;
  const stopId = text(place.stopId); const stopName = text(place.name);
  if (!stopId || !stopName) invalid();
  const rows: TransitBoardRow[] = []; let dropped = 0;
  json.stopTimes.forEach((value, index) => {
    const row = isObject(value) ? parseStopTime(value, context, index) : undefined;
    if (row) rows.push(row); else dropped++;
  });
  return { stop: { id: stopId, name: stopName, code: text(place.stopCode), coordinate: coordinateOf(place) }, rows, dropped };
}

function parseStopTime(record: JsonObject, { event, retrievedAt }: { event: 'departure' | 'arrival'; retrievedAt: number }, index: number): TransitBoardRow | undefined {
  const place = isObject(record.place) ? record.place : undefined;
  if (!place) return undefined;
  const departure = event === 'departure';
  const scheduledAt = instant(departure ? place.scheduledDeparture : place.scheduledArrival);
  const providerTimeAt = instant(departure ? place.departure : place.arrival);
  if (scheduledAt === undefined && providerTimeAt === undefined) return undefined;
  const { state, basis } = classifyEvent({
    realTime: record.realTime, reason: departure ? place.departureTimestampReason : place.arrivalTimestampReason,
    cancelled: record.cancelled, tripCancelled: record.tripCancelled,
  });
  const upstream = upstreamOf(record);
  const headsign = fixName(text(record.headsign), upstream.dataset);
  const destination = fixName(isObject(record.tripTo) ? text(record.tripTo.name) : undefined, upstream.dataset).name;
  const line = text(record.routeShortName); const tripNumber = text(record.tripShortName);
  const tripRef = text(record.tripId);
  const stopId = text(place.stopId) ?? '';
  return {
    id: `transitous:${tripRef ?? `row-${index}`}:${stopId}:${event}`,
    provider: 'transitous', upstream, event, ...modeOf(record.mode),
    line, tripNumber: tripNumber && tripNumber !== line ? tripNumber : undefined, displayName: text(record.displayName),
    headsign: headsign.name, headsignAsSupplied: headsign.asSupplied, destination,
    stop: { id: stopId, name: text(place.name) ?? '' },
    // A cancelled event has no meaningful realtime time; keep the timetable only.
    scheduledAt: scheduledAt ?? (state === 'scheduled' ? providerTimeAt : undefined),
    predictedAt: state === 'declared-realtime-no-source-time' ? providerTimeAt : undefined,
    providerTimeAt, timeBasis: basis, realtimeState: state,
    tripCancelled: record.tripCancelled === true,
    platform: platformOf(place), tripRef, retrievedAt,
    // Transitous publishes no feed or entity timestamp: sourceUpdatedAt intentionally stays unset.
  };
}

export function parseTrip(json: unknown, context: { tripRef: string; retrievedAt: number }): Omit<TransitTripDetails, 'nextRefreshAt' | 'attributions' | 'sourcesUrl' | 'warnings'> & { warnings: string[] } {
  if (!isObject(json) || !Array.isArray(json.legs)) invalid();
  const leg = json.legs.find((value): value is JsonObject => isObject(value) && text(value.tripId) !== undefined);
  if (!leg || !isObject(leg.from) || !isObject(leg.to)) invalid();
  const upstream = upstreamOf(leg);
  const places = [leg.from, ...(Array.isArray(leg.intermediateStops) ? leg.intermediateStops : []), leg.to];
  let dropped = 0;
  const stops = places.flatMap((value): TransitTripStop[] => {
    const stop = isObject(value) ? parseTripStop(value, upstream.dataset) : undefined;
    if (!stop) { dropped++; return []; }
    return [stop];
  });
  const headsign = fixName(text(leg.headsign), upstream.dataset);
  const tripCancelled = leg.cancelled === true;
  const line = text(leg.routeShortName); const tripNumber = text(leg.tripShortName);
  const realTime = flag(leg.realTime);
  const realtimeState: TransitRealtimeState = tripCancelled ? 'cancelled'
    : realTime === true ? 'declared-realtime-no-source-time' : realTime === false ? 'scheduled' : 'unknown';
  return {
    provider: 'transitous', tripRef: context.tripRef, upstream, ...modeOf(leg.mode),
    line, tripNumber: tripNumber && tripNumber !== line ? tripNumber : undefined, displayName: text(leg.displayName),
    headsign: headsign.name, headsignAsSupplied: headsign.asSupplied, realtimeState, tripCancelled, stops,
    retrievedAt: context.retrievedAt,
    warnings: dropped ? [`${dropped} fermate scartate perché incomplete.`] : [],
  };
}

function parseTripStop(place: JsonObject, dataset: string | undefined): TransitTripStop | undefined {
  const stopId = text(place.stopId); const supplied = text(place.name);
  if (!stopId || !supplied) return undefined;
  const name = fixName(supplied, dataset);
  const side = (scheduled: unknown, actual: unknown, reason: unknown) => {
    const basis: TransitTimeBasis = text(reason) ? BASES[text(reason)!] ?? 'unknown' : 'unknown';
    return { scheduledAt: instant(scheduled), predictedAt: isRealtimeBasis(basis) ? instant(actual) : undefined, basis };
  };
  const arrival = side(place.scheduledArrival, place.arrival, place.arrivalTimestampReason);
  const departure = side(place.scheduledDeparture, place.departure, place.departureTimestampReason);
  return {
    stopId, name: name.name ?? supplied, nameAsSupplied: name.asSupplied, coordinate: coordinateOf(place),
    scheduledArrivalAt: arrival.scheduledAt, scheduledDepartureAt: departure.scheduledAt,
    predictedArrivalAt: arrival.predictedAt, predictedDepartureAt: departure.predictedAt,
    arrivalBasis: arrival.basis, departureBasis: departure.basis,
    cancelled: place.cancelled === true, platform: platformOf(place),
  };
}

export interface TransitousStopMatch { stopId: string; name: string; coordinate: Coordinate; modes: string[]; parentId?: string }

export function parseStopMatches(json: unknown): TransitousStopMatch[] {
  if (!Array.isArray(json)) invalid();
  return json.flatMap((value): TransitousStopMatch[] => {
    if (!isObject(value)) return [];
    const stopId = text(value.stopId) ?? (value.type === 'STOP' ? text(value.id) : undefined);
    const name = text(value.name); const coordinate = coordinateOf(value);
    if (!stopId || !name || !coordinate) return [];
    const modes = Array.isArray(value.modes) ? value.modes.filter((mode): mode is string => typeof mode === 'string') : [];
    return [{ stopId, name, coordinate, modes, parentId: text(value.parentId) }];
  });
}

function attributionsFor(sources: TransitUpstreamSource[]): string[] {
  const known = [...new Set(sources.map(source => source.attribution).filter((value): value is string => !!value))];
  const unknown = sources.some(source => !source.attribution);
  return [`Transitous (${TRANSITOUS_SOURCES_URL})`, ...known, ...(unknown ? [`Altre fonti originali: ${TRANSITOUS_SOURCES_URL}`] : [])];
}

function boardWarnings(parsed: ParsedStopTimes): string[] {
  const warnings: string[] = [];
  if (!parsed.rows.length) warnings.push('Transitous non ha restituito corse per questa fermata. Non significa che non ci siano corse.');
  if (parsed.dropped) warnings.push(`${parsed.dropped} corse scartate perché incomplete.`);
  if (parsed.rows.length && !parsed.rows.some(row => row.realtimeState === 'declared-realtime-no-source-time' || row.realtimeState === 'cancelled')) {
    warnings.push('Nessun dato in tempo reale: sono mostrati solo orari programmati.');
  }
  return warnings;
}

// ---------------------------------------------------------------------------------------------
// Client

type Queue = <T>(request: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
export interface TransitousClientOptions { userAgent: string; now?: () => number; queue?: Queue }
interface CacheEntry { value: unknown; at: number; ttl: number }

export function createTransitousClient(options: TransitousClientOptions) {
  const now = options.now ?? Date.now;
  const queue = options.queue ?? requestQueue(REQUEST_SPACING_MS);
  const cache = new Map<string, CacheEntry>();
  const fresh = (key: string): CacheEntry | undefined => {
    const entry = cache.get(key); const current = now();
    // A clock moved backwards invalidates the entry rather than extending it.
    return entry && current >= entry.at && current - entry.at < entry.ttl ? entry : undefined;
  };
  const store = (key: string, value: unknown, at: number, ttl: number) => {
    cache.delete(key); cache.set(key, { value, at, ttl });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  };

  async function request<T>(path: string, params: [string, string][], ttl: number, parse: (json: unknown, retrievedAt: number) => T, signal?: AbortSignal, notFound = 'Fermata non trovata su Transitous.'): Promise<T> {
    checkAbort(signal);
    const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
    const url = `${TRANSITOUS_API}${path}?${query}`;
    const cached = fresh(url);
    if (cached) return cached.value as T;
    return queue(async () => {
      const again = fresh(url);
      if (again) return again.value as T;
      let json: unknown;
      try {
        json = await fetchJSON<unknown>(url, { signal, headers: { 'User-Agent': options.userAgent, Accept: 'application/json' } }, 'transitous');
      } catch (error) {
        if (error instanceof ServiceError && error.status === 404) throw new ServiceError(notFound, 'unavailable', 404);
        throw error;
      }
      checkAbort(signal);
      const retrievedAt = now();
      const value = parseServiceData('transitous', () => parse(json, retrievedAt));
      store(url, value, retrievedAt, ttl);
      return value;
    }, signal);
  }

  function snapshot(parsed: ParsedStopTimes, event: 'departure' | 'arrival', retrievedAt: number, stop: TransitBoardSnapshot['stop'], extraWarnings: string[] = []): TransitBoardSnapshot {
    const rows = [...parsed.rows].sort((a, b) => (a.predictedAt ?? a.scheduledAt ?? a.providerTimeAt ?? Infinity) - (b.predictedAt ?? b.scheduledAt ?? b.providerTimeAt ?? Infinity));
    return {
      provider: 'transitous', event, stop, rows, retrievedAt, nextRefreshAt: retrievedAt + TRANSITOUS_MIN_REFRESH_MS,
      attributions: attributionsFor(rows.map(row => row.upstream)), sourcesUrl: TRANSITOUS_SOURCES_URL,
      warnings: [...extraWarnings, ...boardWarnings(parsed)],
    };
  }

  return {
    /** Rail pilot board. Sends only the station's Transitous stop ID and fixed parameters. */
    getRailStationBoard(station: RailPilotStation, opts: { event?: 'departure' | 'arrival'; signal?: AbortSignal } = {}): Promise<TransitBoardSnapshot> {
      const event = opts.event ?? 'departure';
      const params: [string, string][] = [['stopId', station.transitousStopId], ['n', String(RAIL_BOARD_SIZE)]];
      if (event === 'arrival') params.push(['arriveBy', 'true']);
      return request('/api/v6/stoptimes', params, TRANSITOUS_MIN_REFRESH_MS, (json, retrievedAt) => {
        const parsed = parseStopTimes(json, { event, retrievedAt });
        const coordinate = parsed.stop.coordinate;
        if (parsed.stop.id !== station.transitousStopId || !coordinate || distanceMeters(coordinate, station.coordinate) > STATION_MATCH_METERS) {
          throw new ServiceError('La stazione restituita da Transitous non corrisponde alla mappatura verificata. Nessun orario mostrato.', 'invalid');
        }
        return snapshot(parsed, event, retrievedAt, { id: station.transitousStopId, name: station.name, coordinate: station.coordinate });
      }, opts.signal, 'Stazione non trovata su Transitous.');
    },

    /**
     * Explicit fallback for a bundled GTT stop ("Cerca su Transitous"). The Transitous ID is derived from the
     * GTT stop_id, so no lookup request is needed. `radius=0&exactRadius=true` restricts the board to that pole
     * (MOTIS otherwise merges same-named poles across the street). The response must match the bundled stop.
     */
    getGttStopFallbackBoard(stop: Pick<Stop, 'id' | 'code' | 'name' | 'coordinate'>, opts: { signal?: AbortSignal } = {}): Promise<TransitBoardSnapshot> {
      const stopId = transitousGttStopId(stop.id);
      const params: [string, string][] = [['stopId', stopId], ['n', String(STOP_BOARD_SIZE)], ['radius', '0'], ['exactRadius', 'true']];
      return request('/api/v6/stoptimes', params, TRANSITOUS_MIN_REFRESH_MS, (json, retrievedAt) => {
        const parsed = parseStopTimes(json, { event: 'departure', retrievedAt });
        const coordinate = parsed.stop.coordinate;
        const codeMismatch = parsed.stop.code !== undefined && parsed.stop.code !== stop.code;
        if (parsed.stop.id !== stopId || codeMismatch || !coordinate || distanceMeters(coordinate, stop.coordinate) > STOP_MATCH_METERS) {
          throw new ServiceError('La fermata trovata su Transitous non corrisponde a quella selezionata. Nessun orario mostrato.', 'invalid');
        }
        return snapshot(parsed, 'departure', retrievedAt, { id: stop.id, name: stop.name, coordinate: stop.coordinate },
          ['Fonte: Transitous (dati GTT tramite BusOne), non il feed GTT diretto. Orari non uniti a quelli locali.']);
      }, opts.signal);
    },

    /** Intermediate stops for a row's `tripRef`. `detailedLegs=false` skips geometry the board does not need. */
    getTripDetails(tripRef: string, opts: { signal?: AbortSignal } = {}): Promise<TransitTripDetails> {
      if (!text(tripRef) || tripRef.length > 256) return Promise.reject(new ServiceError('Corsa non valida.', 'invalid'));
      return request('/api/v6/trip', [['tripId', tripRef], ['detailedLegs', 'false']], TRANSITOUS_MIN_REFRESH_MS, (json, retrievedAt) => {
        const trip = parseTrip(json, { tripRef, retrievedAt });
        return { ...trip, nextRefreshAt: retrievedAt + TRANSITOUS_MIN_REFRESH_MS, attributions: attributionsFor([trip.upstream]), sourcesUrl: TRANSITOUS_SOURCES_URL };
      }, opts.signal, 'Corsa non trovata su Transitous.');
    },

    /** Stop search by typed name within a fixed Turin-region box. Sends the typed text, never a position. */
    searchStops(query: string, opts: { signal?: AbortSignal } = {}): Promise<TransitousStopMatch[]> {
      const value = query.trim();
      if (value.length < 2 || value.length > 100) return Promise.reject(new ServiceError('Testo di ricerca non valido.', 'invalid'));
      const params: [string, string][] = [['text', value], ['type', 'STOP'], ['numResults', '8'], ['min', TURIN_REGION.min], ['max', TURIN_REGION.max]];
      return request('/api/v1/geocode', params, LOOKUP_CACHE_MS, json => parseStopMatches(json), opts.signal);
    },

    /**
     * Transitous stops around a public stop or station (for mapping checks). Accepts only a bundled
     * stop/station object, never a device position; the box extends about 150 m around the public coordinate.
     */
    stopsAroundPublicStop(stop: Pick<Stop, 'coordinate'> | Pick<RailPilotStation, 'coordinate'>, opts: { signal?: AbortSignal } = {}): Promise<TransitousStopMatch[]> {
      const { latitude, longitude } = stop.coordinate;
      if (!validCoordinate(stop.coordinate)) return Promise.reject(new ServiceError('Coordinate non valide.', 'invalid'));
      const dLat = 0.00135; const dLon = 0.0019;
      const corner = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
      const params: [string, string][] = [['min', corner(latitude - dLat, longitude - dLon)], ['max', corner(latitude + dLat, longitude + dLon)]];
      return request('/api/v6/map/stops', params, LOOKUP_CACHE_MS, json => parseStopMatches(json), opts.signal);
    },

    /** For tests and memory pressure; never needed for correctness. */
    clearCache() { cache.clear(); },
  };
}
export type TransitousClient = ReturnType<typeof createTransitousClient>;
