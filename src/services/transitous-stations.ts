import railData from '../data/transitous-rail-stations.json';
import type { Coordinate } from '../domain/types';
import { distanceMeters } from './geo';

/** A Turin-area rail station whose Transitous stop ID was verified against coordinates and live departures. */
export interface RailPilotStation {
  key: string;
  /** Display name chosen for the app. */
  name: string;
  transitousStopId: string;
  /** Name exactly as Transitous published it at verification time. */
  transitousName: string;
  coordinate: Coordinate;
  transitousModes: string[];
}

export const RAIL_PILOT_DATA = railData as {
  provider: 'transitous'; verifiedAt: string; dataset: string; attribution: string; sourcesUrl: string; method: string;
  excluded: { name: string; reason: string }[]; stations: RailPilotStation[];
};
export const RAIL_PILOT_STATIONS: readonly RailPilotStation[] = RAIL_PILOT_DATA.stations;

export function getRailPilotStation(key: string): RailPilotStation | undefined {
  return RAIL_PILOT_STATIONS.find(station => station.key === key);
}

/** Local-only lookup; computes distances on the device and sends nothing. */
export function nearestRailPilotStations(center: Coordinate, options: { radiusMeters?: number; limit?: number } = {}): (RailPilotStation & { distanceMeters: number })[] {
  return RAIL_PILOT_STATIONS.map(station => ({ ...station, distanceMeters: distanceMeters(center, station.coordinate) }))
    .filter(station => station.distanceMeters <= (options.radiusMeters ?? 1500))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, options.limit ?? 3);
}
