import manifest from '../data/manifest.json';
import type { Coordinate, PlaceCoverage } from '../domain/types';
import { distanceMeters } from './geo';

export const LOCAL_SEARCH_RADIUS_METERS = 5000;
export const PLACE_BOUNDS: PlaceCoverage['bounds'] = [
  manifest.places.bounds[0]!, manifest.places.bounds[1]!,
  manifest.places.bounds[2]!, manifest.places.bounds[3]!,
];

/** Compare a category's search circle with the extraction rectangle, not a city boundary. */
export function getPlaceCoverage(
  center: Coordinate,
  radiusMeters: number | null = LOCAL_SEARCH_RADIUS_METERS,
  bounds: PlaceCoverage['bounds'] = PLACE_BOUNDS,
): PlaceCoverage {
  const [west, south, east, north] = bounds;
  const centerInside = center.longitude >= west && center.longitude <= east &&
    center.latitude >= south && center.latitude <= north;
  const coverage: PlaceCoverage = { bounds: [...bounds], centerInside, radiusMeters, extent: 'package' };
  // Names and addresses retain package-wide matching, even when the search center is elsewhere.
  if (radiusMeters === null) return coverage;
  const nearest = {
    longitude: Math.max(west, Math.min(east, center.longitude)),
    latitude: Math.max(south, Math.min(north, center.latitude)),
  };
  if (!centerInside && distanceMeters(center, nearest) > radiusMeters) {
    coverage.extent = 'outside';
  } else if (centerInside && Math.min(
    distanceMeters(center, { ...center, longitude: west }),
    distanceMeters(center, { ...center, longitude: east }),
    distanceMeters(center, { ...center, latitude: south }),
    distanceMeters(center, { ...center, latitude: north }),
  ) >= radiusMeters) {
    coverage.extent = 'contained';
  } else {
    coverage.extent = 'partial';
  }
  return coverage;
}
