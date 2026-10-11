import type { Coordinate, RouteLeg, RoutePlan, RouteStep, TravelMode } from '../domain/types';
import { decodePolyline, validCoordinate } from './geo';
import { fetchJSON, requestQueue, ServiceError } from './network';
const roadRequest = requestQueue(1100); const transitRequest = requestQueue(2000);
export const ROAD_PROFILES = { walk: 'routed-foot', bicycle: 'routed-bike', car: 'routed-car' } as const;
export const MATO_ENDPOINT = 'https://mapi.5t.torino.it/routing/v1/routers/mat/index/graphql';
export function roadRouteURL(from: Coordinate, to: Coordinate, mode: Exclude<TravelMode, 'transit'>): string {
  return `https://routing.openstreetmap.de/${ROAD_PROFILES[mode]}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?steps=true&overview=full&geometries=geojson&alternatives=false`;
}
interface OSRMStep { name: string; distance: number; maneuver: { type: string; modifier?: string; location: [number, number] } }
interface OSRMResponse { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OSRMStep[] }[] }[] }
function maneuverInstruction(step: OSRMStep): string {
  const modifier: Record<string, string> = { left: 'a sinistra', right: 'a destra', 'slight left': 'leggermente a sinistra', 'slight right': 'leggermente a destra', 'sharp left': 'nettamente a sinistra', 'sharp right': 'nettamente a destra', straight: 'dritto', uturn: 'fai inversione' };
  const direction = modifier[step.maneuver.modifier ?? ''] ?? '';
  const road = step.name ? ` su ${step.name}` : '';
  switch (step.maneuver.type) {
    case 'depart': return `Parti${road}`;
    case 'arrive': return 'Arrivo a destinazione';
    case 'roundabout': case 'rotary': return `Alla rotatoria prosegui${road}`;
    case 'turn': return `Svolta ${direction}${road}`.trim();
    default: return `Prosegui ${direction}${road}`.trim();
  }
}
export function parseRoadRoute(data: OSRMResponse, mode: Exclude<TravelMode, 'transit'>): RoutePlan {
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route || !route.geometry?.coordinates?.length) throw new ServiceError('Nessun percorso trovato per questo mezzo.', 'unavailable');
  const geometry = route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  const steps: RouteStep[] = route.legs.flatMap(l => l.steps).map(s => ({ instruction: maneuverInstruction(s), distanceMeters: s.distance, coordinate: { longitude: s.maneuver.location[0], latitude: s.maneuver.location[1] } }));
  return { id: `road:${Date.now()}`, mode, distanceMeters: route.distance, durationSeconds: route.duration, geometry,
    legs: [{ mode, from: 'Partenza', to: 'Destinazione', durationSeconds: route.duration, distanceMeters: route.distance, realTime: false, geometry, steps }],
    source: 'FOSSGIS / OpenStreetMap', warnings: ['Percorso senza traffico in tempo reale. Anteprima e indicazioni: guida vocale e navigazione in background non incluse.'], fetchedAt: Date.now() };
}
interface MatoLeg { mode: string; duration: number; distance: number; realTime: boolean; startTime: number; endTime: number; route?: { shortName?: string; longName?: string } | null; from: { name: string }; to: { name: string }; legGeometry?: { points?: string } }
export interface MatoResponse { errors?: { message?: string }[]; data?: { plan?: { itineraries?: { duration: number; legs: MatoLeg[] }[] } } }
export function parseTransitRoute(data: MatoResponse): RoutePlan {
  if (data.errors?.length) throw new ServiceError('MATO non riesce a calcolare il viaggio. Riprova più tardi.', 'unavailable');
  const itinerary = data.data?.plan?.itineraries?.[0];
  if (!itinerary?.legs?.length) throw new ServiceError('Nessun viaggio trovato. Cambia destinazione o riprova più tardi.', 'unavailable');
  const legs: RouteLeg[] = itinerary.legs.map(l => ({ mode: l.mode.toLowerCase(), line: l.route?.shortName ?? l.route?.longName, from: l.from.name === 'Origin' ? 'Partenza' : l.from.name,
    to: l.to.name === 'Destination' ? 'Destinazione' : l.to.name, durationSeconds: l.duration, distanceMeters: l.distance, departureAt: l.startTime, arrivalAt: l.endTime,
    realTime: l.realTime === true, geometry: l.legGeometry?.points ? decodePolyline(l.legGeometry.points) : [], steps: [] }));
  const warnings = ['MATO / 5T: integrazione sperimentale con servizio pubblico senza disponibilità garantita.'];
  if (legs.some(l => l.mode !== 'walk' && !l.realTime)) warnings.push('Alcune tratte usano orari programmati, senza previsione in tempo reale. Verifica le partenze prima di viaggiare.');
  if (legs.every(l => l.mode === 'walk')) warnings.push('Il servizio propone solo un percorso a piedi. Nessun collegamento pubblico trovato per questa richiesta.');
  return { id: `transit:${Date.now()}`, mode: 'transit', distanceMeters: legs.reduce((s, l) => s + l.distanceMeters, 0), durationSeconds: itinerary.duration,
    geometry: legs.flatMap(l => l.geometry), legs, source: 'MATO / 5T', warnings, fetchedAt: Date.now() };
}
export function romeDateTime(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export async function planRoute(options: { from: Coordinate; to: Coordinate; mode: TravelMode; signal?: AbortSignal }): Promise<RoutePlan> {
  const { from, to, mode, signal } = options;
  if (!validCoordinate(from) || !validCoordinate(to)) throw new ServiceError('Posizione non valida.', 'invalid');
  if (mode !== 'transit') return parseRoadRoute(await roadRequest(() => fetchJSON<OSRMResponse>(roadRouteURL(from, to, mode), { signal }), signal), mode);
  const { date, time } = romeDateTime();
  const query = `query { plan(from:{lat:${from.latitude},lon:${from.longitude}},to:{lat:${to.latitude},lon:${to.longitude}},date:"${date}",time:"${time}",numItineraries:2) { itineraries { duration legs { mode duration distance realTime startTime endTime route { shortName longName } from { name } to { name } legGeometry { points } } } } }`;
  return parseTransitRoute(await transitRequest(() => fetchJSON<MatoResponse>(MATO_ENDPOINT, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }), signal));
}
