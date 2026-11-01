import bundled from '../data/gtt-stops.json';
import type { Stop } from '../domain/types';
import type { TimetableReader } from './reader';

/**
 * Synchronous stop list for map/search consumers. Starts from the stop index generated with the
 * bundled package and is replaced by the active package's own stops, so stop boards never mix datasets.
 */
interface Catalog { packageHash: string; feedVersion: string; stops: readonly Stop[]; byId: Map<string, Stop>; routes: Map<string, readonly string[]> }
interface StopIndexFile { package_hash: string; feed_version: string; stops: Stop[]; stop_routes: Record<string, string[]> }

function catalog(packageHash: string, feedVersion: string, stops: Stop[], routes: Map<string, readonly string[]>): Catalog {
  const frozen = Object.freeze(stops.map(stop => Object.freeze({ ...stop, coordinate: Object.freeze({ ...stop.coordinate }), lines: Object.freeze([...stop.lines]) as string[] })));
  return { packageHash, feedVersion, stops: frozen, byId: new Map(frozen.map(stop => [stop.id, stop])), routes };
}
const file = bundled as unknown as StopIndexFile;
let current = catalog(file.package_hash, file.feed_version, file.stops, new Map(Object.entries(file.stop_routes)));
const listeners = new Set<() => void>();

export function catalogStops(): readonly Stop[] { return current.stops; }
export function catalogStop(stopId: string): Stop | undefined { return current.byId.get(stopId); }
export function catalogStopRoutes(stopId: string): readonly string[] { return current.routes.get(stopId) ?? []; }
export function catalogVersion() { return { packageHash: current.packageHash, feedVersion: current.feedVersion }; }
export function subscribeCatalog(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Adopt the stops of the active package (after first import or a package switch). */
export async function adoptCatalog(reader: TimetableReader): Promise<void> {
  if (reader.meta.packageHash === current.packageHash) return;
  const [stops, stopRoutes, routes] = await Promise.all([reader.stops(), reader.stopRoutes(), reader.routes()]);
  const next: Stop[] = stops.filter(stop => stop.locationType === 0).map(stop => ({
    id: stop.stopId, code: stop.code, name: stop.name, coordinate: { latitude: stop.lat, longitude: stop.lon },
    lines: [...new Set((stopRoutes.get(stop.stopId) ?? []).map(route => routes.get(route)?.shortName || route))].sort(),
  }));
  current = catalog(reader.meta.packageHash, reader.meta.feedVersion, next, stopRoutes);
  listeners.forEach(listener => { try { listener(); } catch { /* observers cannot break the catalog */ } });
}
