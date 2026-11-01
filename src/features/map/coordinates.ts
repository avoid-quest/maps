import type { Coordinate } from '../../domain/types';
import type { MapCoordinate } from './MapCanvas.types';

/** A country view is a browsing fallback, never a claimed device position. */
export const INITIAL_MAP: Coordinate = { latitude: 42.5, longitude: 12.5 };
export const tuple = (point: Coordinate): MapCoordinate => [point.longitude, point.latitude];
export const point = (coordinate: MapCoordinate): Coordinate => ({ longitude: coordinate[0], latitude: coordinate[1] });
