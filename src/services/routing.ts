import type { Coordinate, RouteLeg, RoutePlan, RouteStep, RouteStop, TransitTime, TravelMode } from '../domain/types';
import { nativeRoadRouting } from '../platform/road-routing';
import type { RoadMode, RoadRouteResponse, RoadRoutingTransport } from '../platform/road-routing.types';
import { diagnostics, type DiagnosticInput } from './diagnostics';
import { decodePolyline, validCoordinate } from './geo';
import { checkAbort, fetchJSON, parseServiceData, requestQueue, ServiceError } from './network';
import { resolveTransitTime } from './transit-time';
export { resolveTransitTime, romeDateTime } from './transit-time';
const transitRequest = requestQueue(2000);
export const ROAD_PROFILES = { walk: 'routed-foot', bicycle: 'routed-bike', car: 'routed-car' } as const;
export const MATO_ENDPOINT = 'https://mapi.5t.torino.it/routing/v1/routers/mat/index/graphql';
export function roadRouteURL(from: Coordinate, to: Coordinate, mode: Exclude<TravelMode, 'transit'>): string {
  return `https://routing.openstreetmap.de/${ROAD_PROFILES[mode]}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?steps=true&overview=full&geometries=geojson&alternatives=false`;
}
interface OSRMStep { name: string; distance: number; maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number } }
interface OSRMResponse { code: string; routes?: { distance: number; duration: number; geometry: string | { coordinates: [number, number][] }; legs: { steps: OSRMStep[] }[] }[] }
function invalidRoadData(): never { throw new ServiceError('Il servizio ha restituito dati di percorso non validi. Riprova.', 'invalid'); }
function roadCoordinate(value: unknown): Coordinate {
  if (!Array.isArray(value) || value.length !== 2) invalidRoadData();
  const coordinate = { longitude: value[0], latitude: value[1] };
  if (!validCoordinate(coordinate)) invalidRoadData();
  return coordinate;
}
/** OSRM's native navigation response uses six decimal places; transit keeps polyline5. */
function decodeRoadPolyline(encoded: string): Coordinate[] {
  const result: Coordinate[] = []; let index = 0; let latitude = 0; let longitude = 0;
  const component = () => {
    let value = 0; let shift = 0; let byte: number;
    do {
      if (index >= encoded.length || shift > 30) invalidRoadData();
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) invalidRoadData();
      value += (byte & 31) * 2 ** shift; shift += 5;
    } while (byte >= 32);
    return value % 2 ? -(value + 1) / 2 : value / 2;
  };
  while (index < encoded.length) {
    latitude += component(); longitude += component();
    const coordinate = { latitude: latitude / 1e6, longitude: longitude / 1e6 };
    if (!validCoordinate(coordinate)) invalidRoadData();
    result.push(coordinate);
  }
  return result;
}
function maneuverInstruction(step: OSRMStep): string {
  const modifier: Record<string, string> = { left: 'a sinistra', right: 'a destra', 'slight left': 'leggermente a sinistra', 'slight right': 'leggermente a destra', 'sharp left': 'nettamente a sinistra', 'sharp right': 'nettamente a destra', straight: 'dritto', uturn: 'fai inversione' };
  const direction = modifier[step.maneuver.modifier ?? ''] ?? '';
  const road = step.name ? ` su ${step.name}` : '';
  switch (step.maneuver.type) {
    case 'depart': return `Parti${road}`;
    case 'arrive': return 'Arrivo a destinazione';
    case 'roundabout': case 'rotary': return step.maneuver.exit ? `Alla rotatoria prendi l’uscita ${step.maneuver.exit}${road}` : `Alla rotatoria prosegui${road}`;
    case 'turn': return `Svolta ${direction}${road}`.trim();
    default: return `Prosegui ${direction}${road}`.trim();
  }
}
export function parseRoadRoute(data: OSRMResponse, mode: Exclude<TravelMode, 'transit'>, fetchedAt = Date.now()): RoutePlan {
  if (!data || typeof data.code !== 'string') invalidRoadData();
  if (data.code !== 'Ok') throw new ServiceError('Nessun percorso trovato per questo mezzo.', 'unavailable');
  const route = data.routes?.[0];
  if (!route || !nonnegative(route.distance) || !nonnegative(route.duration) || !timestamp(fetchedAt)
    || !Array.isArray(route.legs) || !route.legs.length) invalidRoadData();
  const geometry = typeof route.geometry === 'string' ? decodeRoadPolyline(route.geometry)
    : Array.isArray(route.geometry?.coordinates) ? route.geometry.coordinates.map(roadCoordinate) : invalidRoadData();
  if (geometry.length < 2) invalidRoadData();
  const steps: RouteStep[] = route.legs.flatMap(leg => {
    if (!leg || !Array.isArray(leg.steps)) invalidRoadData();
    return leg.steps.map(step => {
      if (!step || typeof step.name !== 'string' || !nonnegative(step.distance) || !step.maneuver
        || typeof step.maneuver.type !== 'string' || !step.maneuver.type
        || (step.maneuver.modifier !== undefined && typeof step.maneuver.modifier !== 'string')
        || (step.maneuver.exit !== undefined && (!Number.isInteger(step.maneuver.exit) || step.maneuver.exit <= 0))) invalidRoadData();
      return { instruction: maneuverInstruction(step), distanceMeters: step.distance, coordinate: roadCoordinate(step.maneuver.location) };
    });
  });
  // The same decoded geometry retains the existing saved-preview identity for either encoding.
  const id = `road:${mode}:${JSON.stringify(geometry.map(({ longitude, latitude }) => [longitude, latitude]))}`;
  return { id, mode, distanceMeters: route.distance, durationSeconds: route.duration, geometry,
    walkingDurationSeconds: mode === 'walk' ? route.duration : 0, walkingDistanceMeters: mode === 'walk' ? route.distance : 0, waitingDurationSeconds: 0, transferCount: 0,
    legs: [{ id, transitLeg: false, interlineWithPreviousLeg: false, timingStatus: 'unknown', mode, from: 'Partenza', to: 'Destinazione', durationSeconds: route.duration, distanceMeters: route.distance, realTime: false, geometry, steps }],
    source: 'FOSSGIS / OpenStreetMap', warnings: ['Percorso senza traffico in tempo reale. Questa è un’anteprima: avvia la navigazione per seguire il viaggio dalla tua posizione.'], fetchedAt };
}

type RoadRouteOptions = { from: Coordinate; to: Coordinate; mode: RoadMode; signal?: AbortSignal };
const roadRequestGeneration = Math.random().toString(36).slice(2);
let roadRequestSequence = 0;
function abortRoadRequest(): Error { return Object.assign(new Error('Request cancelled'), { name: 'AbortError' }); }
function nativeRoadError(error: unknown): { error: ServiceError | Error; state: Extract<DiagnosticInput, { type: 'request' }>['state'] } {
  // Native exceptions may contain provider URLs or coordinates. Read only the fixed code.
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'cancelled': return { error: abortRoadRequest(), state: 'cancelled' };
    case 'rate-limit': return { error: new ServiceError('Il servizio ha limitato le richieste. Riprova tra un minuto.', 'rate-limit'), state: 'rate-limit' };
    case 'timeout': return { error: new ServiceError('Il servizio non ha risposto in tempo. Riprova.'), state: 'timeout' };
    case 'network': return { error: new ServiceError('Connessione non disponibile. Controlla la rete e riprova.'), state: 'network' };
    case 'invalid': return { error: new ServiceError('Il servizio ha restituito dati di percorso non validi. Riprova.', 'invalid'), state: 'invalid' };
    default: return { error: new ServiceError('Servizio di percorsi temporaneamente non disponibile. Riprova.', 'unavailable'), state: 'unavailable' };
  }
}
async function requestNativeRoadRoute(options: RoadRouteOptions, transport: RoadRoutingTransport): Promise<RoadRouteResponse> {
  const { from, to, mode, signal } = options;
  checkAbort(signal);
  const requestId = `preview-${roadRequestGeneration}-${++roadRequestSequence}`;
  const started = Date.now();
  let state: Extract<DiagnosticInput, { type: 'request' }>['state'] = 'ok';
  try {
    return await new Promise<RoadRouteResponse>((resolve, reject) => {
      let settled = false;
      const complete = (value?: RoadRouteResponse, error?: unknown) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', cancel);
        if (error !== undefined) reject(error);
        else if (value) resolve(value);
        else reject({ code: 'invalid' });
      };
      const cancel = () => {
        if (settled) return;
        // Settle even if the native call or bridge cancellation stalls.
        complete(undefined, abortRoadRequest());
        try { void Promise.resolve(transport.cancelRoadRoute(requestId)).catch(() => undefined); } catch { /* Cancellation is best effort; obsolete work cannot settle the caller. */ }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      try { void transport.requestRoadRoute(requestId, from, to, mode).then(value => complete(value), error => complete(undefined, error)); }
      catch (error) { complete(undefined, error); }
    });
  } catch (error) {
    if (signal?.aborted) { state = 'cancelled'; throw abortRoadRequest(); }
    const translated = nativeRoadError(error); state = translated.state; throw translated.error;
  } finally {
    diagnostics.record({ type: 'request', provider: 'fossgis', state, durationMs: Date.now() - started });
  }
}
/** The Android adapter is the sole queue; web retains the established JavaScript queue. */
export function createRoadRoutePlanner(transport: RoadRoutingTransport | null) {
  const webRequest = transport === null ? requestQueue(1100) : null;
  return async (options: RoadRouteOptions): Promise<RoutePlan> => {
    const { from, to, mode, signal } = options;
    if (!validCoordinate(from) || !validCoordinate(to) || !Object.hasOwn(ROAD_PROFILES, mode)) throw new ServiceError('Posizione o mezzo non valido.', 'invalid');
    checkAbort(signal);
    if (!transport) {
      const response = await webRequest!(() => fetchJSON<OSRMResponse>(roadRouteURL(from, to, mode), { signal }, 'fossgis'), signal);
      checkAbort(signal);
      return parseServiceData('fossgis', () => parseRoadRoute(response, mode));
    }
    const response = await requestNativeRoadRoute(options, transport);
    checkAbort(signal);
    return parseServiceData('fossgis', () => {
      if (!response || typeof response.responseJson !== 'string' || !timestamp(response.fetchedAt)) invalidRoadData();
      let data: OSRMResponse;
      try { data = JSON.parse(response.responseJson) as OSRMResponse; } catch { invalidRoadData(); }
      return parseRoadRoute(data, mode, response.fetchedAt);
    });
  };
}
const planRoadRoute = createRoadRoutePlanner(nativeRoadRouting);
interface MatoStop { gtfsId?: string | null; name?: string | null; code?: string | null; platformCode?: string | null; lat?: number | null; lon?: number | null }
interface MatoPoint { name: string; lat?: number | null; lon?: number | null; stop?: MatoStop | null }
export interface MatoLeg {
  mode: string; duration: number; distance: number; realTime?: boolean | null; realtimeState?: string | null;
  transitLeg?: boolean | null; interlineWithPreviousLeg?: boolean | null;
  startTime: number; endTime: number; serviceDate?: string | null;
  route?: { shortName?: string | null; longName?: string | null } | null;
  trip?: { gtfsId?: string | null; tripHeadsign?: string | null } | null;
  from: MatoPoint; to: MatoPoint; legGeometry?: { points?: string | null } | null;
}
export interface MatoItinerary {
  duration: number; startTime?: number | null; endTime?: number | null;
  walkTime?: number | null; walkDistance?: number | null; waitingTime?: number | null; legs: MatoLeg[];
}
export interface MatoResponse { errors?: { message?: string }[]; data?: { plan?: { itineraries?: MatoItinerary[] | null } | null } | null }

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function invalidTransitData(): never { throw new ServiceError('MATO ha restituito dati di viaggio non validi. Riprova.', 'invalid'); }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function timestamp(value: unknown): value is number { return nonnegative(value) && value > 0 && Number.isFinite(new Date(value).getTime()); }
function pointCoordinate(point: { lat?: number | null; lon?: number | null }): Coordinate | undefined {
  const coordinate = { latitude: point.lat as number, longitude: point.lon as number };
  return validCoordinate(coordinate) ? coordinate : undefined;
}
function pointIdentity(point: MatoPoint): string {
  return JSON.stringify([text(point.stop?.gtfsId), pointCoordinate(point), text(point.name), text(point.stop?.code)]);
}
function routeStop(point: MatoPoint): RouteStop | undefined {
  if (!point.stop) return undefined;
  const name = text(point.stop.name) ?? text(point.name);
  if (!name) return undefined;
  // Stop-link matching must see the provider's exact identity, including malformed whitespace.
  const sourceId = typeof point.stop.gtfsId === 'string' ? point.stop.gtfsId : undefined;
  const code = typeof point.stop.code === 'string' && point.stop.code.trim() ? point.stop.code : undefined;
  // The unmatched namespace preserves supplied stop details without inventing a GTFS join.
  return {
    id: sourceId ? `mato:${sourceId}` : `mato:unmatched:${pointIdentity(point)}`,
    name, code, platformCode: text(point.stop.platformCode),
    coordinate: pointCoordinate(point.stop) ?? pointCoordinate(point),
  };
}
function timingStatus(leg: MatoLeg, transitLeg: boolean): RouteLeg['timingStatus'] {
  if (!transitLeg) return 'unknown';
  const state = text(leg.realtimeState)?.toUpperCase();
  if (state === 'CANCELED' || state === 'CANCELLED') return 'cancelled';
  if (state && !['SCHEDULED', 'UPDATED', 'ADDED', 'MODIFIED'].includes(state)) return 'unknown';
  if (state === 'SCHEDULED') return leg.realTime === true ? 'unknown' : 'scheduled';
  if (leg.realTime === true) return 'prediction';
  if (!state && leg.realTime === false) return 'scheduled';
  return 'unknown';
}
function parseItinerary(itinerary: MatoItinerary, fetchedAt: number): RoutePlan {
  if (!itinerary || !Array.isArray(itinerary.legs) || !itinerary.legs.length || !nonnegative(itinerary.duration)) invalidTransitData();
  const legs: RouteLeg[] = itinerary.legs.map((leg, index) => {
    if (!leg || !text(leg.mode) || !leg.from || !text(leg.from.name) || !leg.to || !text(leg.to.name)
      || !nonnegative(leg.duration) || !nonnegative(leg.distance) || !timestamp(leg.startTime) || !timestamp(leg.endTime)
      || leg.endTime < leg.startTime || Math.abs((leg.endTime - leg.startTime) / 1000 - leg.duration) > 1
      || (index > 0 && leg.startTime < itinerary.legs[index - 1]!.endTime)) invalidTransitData();
    const mode = leg.mode.toLowerCase();
    const transitLeg = typeof leg.transitLeg === 'boolean' ? leg.transitLeg : !['walk', 'bicycle', 'car'].includes(mode);
    const previous = itinerary.legs[index - 1];
    const previousIsTransit = previous && (typeof previous.transitLeg === 'boolean' ? previous.transitLeg : !['WALK', 'BICYCLE', 'CAR'].includes(previous.mode.toUpperCase()));
    const fromStop = routeStop(leg.from); const toStop = routeStop(leg.to);
    const tripId = text(leg.trip?.gtfsId); const serviceDate = text(leg.serviceDate);
    let geometry: Coordinate[] = [];
    if (leg.legGeometry?.points != null) {
      if (typeof leg.legGeometry.points !== 'string' || /[^?-~]/.test(leg.legGeometry.points)) invalidTransitData();
      try { geometry = decodePolyline(leg.legGeometry.points); } catch { invalidTransitData(); }
      if (!geometry.every(validCoordinate)) invalidTransitData();
    }
    const status = timingStatus(leg, transitLeg);
    // Known trips retain identity across prediction changes, even without a stop ID.
    // Only unidentified trips need timing hints to avoid merging unrelated services.
    const identity = transitLeg && tripId && serviceDate
      ? [tripId, serviceDate, text(leg.from.stop?.gtfsId) ?? pointIdentity(leg.from), text(leg.to.stop?.gtfsId) ?? pointIdentity(leg.to)]
      : [mode, tripId, serviceDate, pointIdentity(leg.from), pointIdentity(leg.to), leg.route?.shortName, transitLeg ? leg.startTime : undefined, transitLeg ? leg.endTime : undefined, geometry];
    return {
      id: `mato:leg:${JSON.stringify(identity)}`, mode, line: text(leg.route?.shortName) ?? text(leg.route?.longName),
      headsign: text(leg.trip?.tripHeadsign), from: leg.from.name === 'Origin' ? 'Partenza' : leg.from.name,
      to: leg.to.name === 'Destination' ? 'Destinazione' : leg.to.name,
      fromStop, toStop, tripId: tripId ? `mato:${tripId}` : undefined, serviceDate,
      transitLeg, interlineWithPreviousLeg: transitLeg && !!previousIsTransit && leg.interlineWithPreviousLeg === true,
      timingStatus: status, realTime: status === 'prediction',
      durationSeconds: leg.duration, distanceMeters: leg.distance, departureAt: leg.startTime, arrivalAt: leg.endTime,
      geometry, steps: [],
    };
  });
  const departureAt = itinerary.startTime ?? legs[0]!.departureAt!;
  const arrivalAt = itinerary.endTime ?? legs.at(-1)!.arrivalAt!;
  if (!timestamp(departureAt) || !timestamp(arrivalAt) || departureAt > legs[0]!.departureAt! || arrivalAt < legs.at(-1)!.arrivalAt!
    || Math.abs((arrivalAt - departureAt) / 1000 - itinerary.duration) > 1) invalidTransitData();
  const walkLegs = legs.filter(leg => leg.mode === 'walk');
  const walkingDurationSeconds = itinerary.walkTime ?? walkLegs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const walkingDistanceMeters = itinerary.walkDistance ?? walkLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
  const waitingDurationSeconds = itinerary.waitingTime ?? legs.reduce((sum, leg, index) => sum + (index ? (leg.departureAt! - legs[index - 1]!.arrivalAt!) / 1000 : 0), 0);
  if (![walkingDurationSeconds, walkingDistanceMeters, waitingDurationSeconds].every(nonnegative)) invalidTransitData();
  const boardingCount = legs.filter(leg => leg.transitLeg && !leg.interlineWithPreviousLeg).length;
  const duplicateIds = new Set(legs.filter((leg, index) => legs.findIndex(other => other.id === leg.id) !== index).map(leg => leg.id));
  for (const leg of legs) if (duplicateIds.has(leg.id)) leg.id += `:${leg.departureAt}:${leg.arrivalAt}`;
  const warnings = ['MATO / 5T: integrazione sperimentale con servizio pubblico senza disponibilità garantita.'];
  if (legs.some(leg => leg.transitLeg && leg.timingStatus === 'scheduled')) warnings.push('Alcune tratte usano orari programmati, senza previsione in tempo reale. Verifica le partenze prima di viaggiare.');
  if (legs.some(leg => leg.timingStatus === 'cancelled')) warnings.push('Il viaggio include una corsa cancellata. Scegli un’altra alternativa o aggiorna il percorso.');
  if (legs.some(leg => leg.transitLeg && leg.timingStatus === 'unknown')) warnings.push('Lo stato di alcune tratte non è disponibile. Verifica le partenze prima di viaggiare.');
  const walkingOnly = legs.every(leg => leg.mode === 'walk');
  if (walkingOnly) warnings.push('Questa alternativa prevede solo un percorso a piedi.');
  return {
    id: `mato:journey:${JSON.stringify([legs.map(leg => leg.id), walkingOnly ? [departureAt, arrivalAt] : undefined])}`,
    mode: 'transit', departureAt, arrivalAt, distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), durationSeconds: itinerary.duration,
    walkingDurationSeconds, walkingDistanceMeters, waitingDurationSeconds, transferCount: Math.max(0, boardingCount - 1),
    geometry: legs.flatMap(leg => leg.geometry), legs, source: 'MATO / 5T', warnings, fetchedAt,
  };
}

export function parseTransitRoutes(data: MatoResponse, fetchedAt = Date.now()): RoutePlan[] {
  if (!data || typeof data !== 'object') invalidTransitData();
  if (data.errors?.length) throw new ServiceError('MATO non riesce a calcolare il viaggio. Riprova più tardi.', 'unavailable');
  const itineraries = data.data?.plan?.itineraries;
  if (itineraries != null && !Array.isArray(itineraries)) invalidTransitData();
  if (!itineraries?.length) throw new ServiceError('Nessun viaggio trovato. Cambia destinazione o riprova più tardi.', 'unavailable');
  const plans = new Map<string, RoutePlan>(); let invalid = false;
  for (const itinerary of itineraries) {
    try {
      const plan = parseItinerary(itinerary, fetchedAt);
      if (!plans.has(plan.id)) plans.set(plan.id, plan);
    } catch { invalid = true; }
  }
  if (!plans.size) invalidTransitData();
  if (invalid) for (const plan of plans.values()) plan.warnings.push('Alcune alternative contenevano dati non validi e non sono disponibili.');
  return [...plans.values()];
}
export function parseTransitRoute(data: MatoResponse, fetchedAt = Date.now()): RoutePlan { return parseTransitRoutes(data, fetchedAt)[0]!; }

export interface PlanRouteOptions { from: Coordinate; to: Coordinate; mode: TravelMode; signal?: AbortSignal; transitTime?: TransitTime }
export async function planRoutes(options: PlanRouteOptions): Promise<RoutePlan[]> {
  const { from, to, mode, signal } = options;
  if (!validCoordinate(from) || !validCoordinate(to)) throw new ServiceError('Posizione non valida.', 'invalid');
  if (mode !== 'transit') {
    return [await planRoadRoute({ from, to, mode, signal })];
  }
  const { date, time, arriveBy } = resolveTransitTime(options.transitTime);
  const query = `query { plan(from:{lat:${from.latitude},lon:${from.longitude}},to:{lat:${to.latitude},lon:${to.longitude}},date:"${date}",time:"${time}",arriveBy:${arriveBy},numItineraries:2) { itineraries { duration startTime endTime walkTime walkDistance waitingTime legs { mode transitLeg duration distance realTime realtimeState interlineWithPreviousLeg startTime endTime serviceDate route { shortName longName } trip { gtfsId tripHeadsign } from { name lat lon stop { gtfsId name code platformCode } } to { name lat lon stop { gtfsId name code platformCode } } legGeometry { points } } } } }`;
  const response = await transitRequest(() => fetchJSON<MatoResponse>(MATO_ENDPOINT, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }, 'mato'), signal);
  return parseServiceData('mato', () => parseTransitRoutes(response));
}
export async function planRoute(options: PlanRouteOptions): Promise<RoutePlan> { return (await planRoutes(options))[0]!; }
