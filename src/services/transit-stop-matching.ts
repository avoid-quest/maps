import type { RouteStop, Stop } from '../domain/types';
import { catalogStops, subscribeCatalog } from '../transit-data/stop-catalog';
import { distanceMeters, validCoordinate } from './geo';

/** Match provider identity first; proximity only verifies that identity. */
export function createJourneyStopMatcher(stops: readonly Stop[]) {
  const byCode = new Map<string, Stop | null>();
  for (const stop of stops) byCode.set(stop.code, byCode.has(stop.code) ? null : stop);
  return (routeStop: RouteStop | undefined): Stop | null => {
    if (!routeStop) return null;
    const identity = /^mato:gtt:([0-9]+)$/.exec(routeStop.id);
    const code = identity?.[1];
    // JavaScript's $ also matches before a final newline; require the whole supplied ID.
    if (identity?.[0] !== routeStop.id || code === undefined || code !== routeStop.code) return null;
    const stop = byCode.get(code);
    if (!stop?.coordinate || !routeStop.coordinate || !validCoordinate(stop.coordinate) || !validCoordinate(routeStop.coordinate)) return null;
    return distanceMeters(stop.coordinate, routeStop.coordinate) <= 10 ? stop : null;
  };
}

let matcher = createJourneyStopMatcher(catalogStops());
// Follow the active package so journey stops resolve against the same stops as its boards.
subscribeCatalog(() => { matcher = createJourneyStopMatcher(catalogStops()); });
export const matchJourneyStop = (routeStop: RouteStop | undefined): Stop | null => matcher(routeStop);
