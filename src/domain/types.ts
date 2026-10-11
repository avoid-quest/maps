export interface Coordinate { latitude: number; longitude: number }
export type TravelMode = 'walk' | 'bicycle' | 'car' | 'transit';
export interface Place {
  id: string; name: string; coordinate: Coordinate; category?: string; address?: string;
  website?: string; phone?: string; source: string; attributions: string[];
  dataUpdatedAt?: string; confidence?: number; operatingStatus?: string; distanceMeters?: number;
}
export type SavedPlace = Place;
export interface RouteStep { instruction: string; distanceMeters: number; coordinate?: Coordinate }
export interface RouteLeg {
  mode: string; line?: string; headsign?: string; from: string; to: string;
  durationSeconds: number; distanceMeters: number; departureAt?: number; arrivalAt?: number;
  realTime: boolean; geometry: Coordinate[]; steps: RouteStep[];
}
export interface RoutePlan {
  id: string; mode: TravelMode; distanceMeters: number; durationSeconds: number;
  geometry: Coordinate[]; legs: RouteLeg[]; source: string; warnings: string[]; fetchedAt: number;
}
export interface Stop { id: string; code: string; name: string; coordinate: Coordinate; lines: string[]; distanceMeters?: number }
export interface Departure {
  id: string; stopId: string; line: string; headsign: string; expectedAt?: number; scheduledAt?: number;
  status: 'live' | 'scheduled' | 'stale' | 'cancelled' | 'unknown'; sourceUpdatedAt?: number; source: string;
}
export interface DepartureBoard { departures: Departure[]; fetchedAt: number; sourceUpdatedAt?: number; warnings: string[]; source: string }
export interface SearchResult { places: Place[]; warnings: string[]; source: string }
export interface TransitAlert { id: string; title: string; description: string; url?: string; source: string }
