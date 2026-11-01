import type { Coordinate } from '../../domain/types';
import type { MapCoordinate } from './MapCanvas.types';

/** A country view is a browsing fallback, never a claimed device position. */
export const INITIAL_MAP: Coordinate = { latitude: 42.5, longitude: 12.5 };
/** Domain coordinate → MapLibre `[longitude, latitude]`. */
export const toMapCoordinate = (coordinate: Coordinate): MapCoordinate => [coordinate.longitude, coordinate.latitude];
/** MapLibre `[longitude, latitude]` → domain coordinate. */
export const toCoordinate = ([longitude, latitude]: MapCoordinate): Coordinate => ({ longitude, latitude });
