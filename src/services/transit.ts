import { Root } from 'protobufjs/light';
import schema from '../data/gtfs-realtime-schema.json';
import staticStops from '../data/gtt-stops.json';
import staticLookup from '../data/gtt-trips.json';
import manifest from '../data/manifest.json';
import type { Coordinate, Departure, DepartureBoard, Stop, TransitAlert } from '../domain/types';
import { distanceMeters } from './geo';
import { checkAbort, fetchResponse, parseServiceData, requestQueue, ServiceError } from './network';
import { diagnostics } from './diagnostics';
const Feed = Root.fromJSON(schema).lookupType('transit_realtime.FeedMessage');
const GTT = 'https://percorsieorari.gtt.to.it/das_gtfsrt/';
const queue = requestQueue(1500);
const stops = staticStops as Stop[];
type Trip = [line: string, headsign: string, routeId: string, pattern: number];
export interface TripLookup { patterns: Record<string, string>[]; trips: Record<string, Trip> }
const lookup = staticLookup as unknown as TripLookup;
interface EventTime { time?: number | string; delay?: number }
interface StopUpdate { stopSequence?: number; stopId?: string; scheduleRelationship?: string; arrival?: EventTime; departure?: EventTime }
interface Translation { translation?: { text?: string; language?: string }[] }
interface Alert { headerText?: Translation; descriptionText?: Translation; url?: Translation; activePeriod?: { start?: number | string; end?: number | string }[]; informedEntity?: { stopId?: string; routeId?: string }[] }
export interface RTFeed { header?: { gtfsRealtimeVersion?: string; timestamp?: number | string; incrementality?: string }; entity?: { id?: string; isDeleted?: boolean; tripUpdate?: { timestamp?: number | string; trip?: { tripId?: string; scheduleRelationship?: string }; stopTimeUpdate?: StopUpdate[] }; alert?: Alert }[] }
export function getNearbyStops(center: Coordinate, options: { limit?: number; radiusMeters?: number } = {}): Stop[] {
  return stops.map(stop => ({ ...stop, distanceMeters: distanceMeters(center, stop.coordinate) }))
    .filter(s => s.distanceMeters <= (options.radiusMeters ?? 1800)).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, options.limit ?? 18);
}
export function getStop(stopId: string): Stop | undefined { return stops.find(s => s.id === stopId); }
function epoch(time?: number | string): number | undefined { const n = Number(time); return Number.isFinite(n) && n > 0 ? n * 1000 : undefined; }
/** A fresh download is not a fresh prediction: require entity AND feed timestamps. */
export function predictionStatus(feedAt: number | undefined, entityAt: number | undefined, now: number): Departure['status'] {
  if (!feedAt || !entityAt) return 'unknown';
  if (feedAt > now + 60_000 || entityAt > now + 60_000) return 'unknown';
  return now - Math.min(feedAt, entityAt) > 120_000 ? 'stale' : 'live';
}
export function departuresFromFeed(feed: RTFeed, stopId: string, now = Date.now(), index: TripLookup = lookup): DepartureBoard {
  const sourceUpdatedAt = epoch(feed.header?.timestamp); const departures: Departure[] = []; const warnings: string[] = [];
  if (feed.header?.incrementality === 'DIFFERENTIAL') throw new ServiceError('Formato aggiornamenti GTT non supportato. Riprova più tardi.', 'invalid');
  let unmatched = 0;
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate; const tripId = update?.trip?.tripId;
    if (!update || !tripId || entity.isDeleted) continue;
    const trip = index.trips[tripId]; if (!trip) { unmatched++; continue; }
    const pattern = index.patterns[trip[3]];
    const tripCancelled = update.trip?.scheduleRelationship === 'CANCELED';
    const entityAt = epoch(update.timestamp);
    const updates = update.stopTimeUpdate ?? [];
    let matchedCancellation = false;
    for (const stopUpdate of updates) {
      const resolvedStop = stopUpdate.stopId || (stopUpdate.stopSequence !== undefined ? pattern?.[String(stopUpdate.stopSequence)] : undefined);
      if (resolvedStop !== stopId) continue;
      const expectedAt = epoch(stopUpdate.arrival?.time ?? stopUpdate.departure?.time);
      const cancelled = tripCancelled || stopUpdate.scheduleRelationship === 'SKIPPED';
      if (expectedAt && (expectedAt < now - 60_000 || expectedAt > now + 4 * 3_600_000)) continue;
      matchedCancellation ||= cancelled;
      departures.push({ id: `${tripId}:${stopUpdate.stopSequence ?? stopId}`, stopId, line: trip[0], headsign: trip[1], expectedAt,
        status: cancelled ? 'cancelled' : stopUpdate.scheduleRelationship === 'NO_DATA' || !expectedAt ? 'unknown' : predictionStatus(sourceUpdatedAt, entityAt, now),
        sourceUpdatedAt: entityAt, source: 'GTT GTFS-Realtime' });
    }
    if (tripCancelled && !matchedCancellation && Object.values(pattern ?? {}).includes(stopId)) departures.push({ id: `${tripId}:cancelled`, stopId, line: trip[0], headsign: trip[1], status: 'cancelled', sourceUpdatedAt: entityAt, source: 'GTT GTFS-Realtime' });
  }
  if (!sourceUpdatedAt || now - sourceUpdatedAt > 120_000) warnings.push('Il feed GTT non è aggiornato: le previsioni potrebbero essere obsolete.');
  if (unmatched) warnings.push(`${unmatched} corse non corrispondono al pacchetto orari installato. Potrebbe servire un aggiornamento dell’app.`);
  if (!departures.length) warnings.push('Nessuna previsione disponibile per questa fermata. Non significa che non ci siano corse: consulta un viaggio programmato.');
  if (departures.some(d => d.status === 'stale')) warnings.push('Le previsioni contrassegnate come obsolete non sono confermate in tempo reale.');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)).replace(/-/g, '');
  if (date > manifest.gtt.validTo) warnings.push('Il pacchetto statico GTT è scaduto. Aggiorna l’app prima di affidarti alle corrispondenze.');
  return { departures: departures.sort((a, b) => (a.expectedAt ?? Infinity) - (b.expectedAt ?? Infinity)).slice(0, 40), fetchedAt: now, sourceUpdatedAt, warnings, source: 'GTT S.p.A. – Gruppo Torinese Trasporti' };
}
const cache = new Map<string, { at: number; feed: RTFeed }>();
async function fetchFeed(file: string, maxAge: number, signal?: AbortSignal): Promise<RTFeed> {
  checkAbort(signal); const stored = cache.get(file); if (stored && Date.now() - stored.at < maxAge) return stored.feed;
  return queue(async () => {
    const current = cache.get(file); if (current && Date.now() - current.at < maxAge) return current.feed;
    const provider = file === 'trip_update.aspx' ? 'gtt-arrivals' : file === 'alerts.aspx' ? 'gtt-alerts' : 'other';
    const response = await fetchResponse(`${GTT}${file}`, { signal }, provider);
    try {
      const decoded = Feed.decode(new Uint8Array(await response.arrayBuffer()));
      const feed = Feed.toObject(decoded, { longs: Number, enums: String }) as RTFeed;
      if (!feed.header?.gtfsRealtimeVersion) throw new Error('missing feed header');
      // Protobuf omits an empty repeated field; an empty FULL_DATASET is a valid no-predictions snapshot.
      feed.entity ??= [];
      cache.set(file, { at: Date.now(), feed }); return feed;
    } catch {
      diagnostics.record({ type: 'service', state: 'invalid', provider });
      throw new ServiceError('GTT ha restituito un feed non valido. Nessuna previsione inventata.', 'invalid');
    }
  }, signal);
}
export async function getDepartures(stopId: string, options: { signal?: AbortSignal } = {}): Promise<DepartureBoard> {
  if (!getStop(stopId)) throw new ServiceError('Fermata non presente nel pacchetto installato.', 'invalid');
  const feed = await fetchFeed('trip_update.aspx', 30_000, options.signal);
  return parseServiceData('gtt-arrivals', () => departuresFromFeed(feed, stopId));
}
function text(value?: Translation): string { return value?.translation?.find(t => t.language === 'it')?.text ?? value?.translation?.[0]?.text ?? ''; }
export async function getTransitAlerts(stopId?: string, options: { signal?: AbortSignal } = {}): Promise<TransitAlert[]> {
  const feed = await fetchFeed('alerts.aspx', 5 * 60_000, options.signal); const now = Date.now();
  const stop = stopId ? getStop(stopId) : undefined;
  const routeIds = stop ? new Set(Object.values(lookup.trips).filter(t => stop.lines.includes(t[0])).map(t => t[2])) : undefined;
  return (feed.entity ?? []).flatMap(entity => {
    const alert = entity.alert; if (!alert) return [];
    if (alert.activePeriod?.length && !alert.activePeriod.some(p => (!epoch(p.start) || epoch(p.start)! <= now) && (!epoch(p.end) || epoch(p.end)! >= now))) return [];
    if (stopId && alert.informedEntity?.length && !alert.informedEntity.some(e => e.stopId === stopId || (!e.stopId && (!e.routeId || routeIds?.has(e.routeId))))) return [];
    return [{ id: entity.id ?? text(alert.headerText), title: text(alert.headerText), description: text(alert.descriptionText), url: text(alert.url) || undefined, source: 'GTT S.p.A. – Gruppo Torinese Trasporti' }];
  }).slice(0, 30);
}
