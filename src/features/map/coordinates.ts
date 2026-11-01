import type { Coordinate } from '../../domain/types';
import type { MapCoordinate } from './MapCanvas.types';

/**
 * Without a fix or a saved view the map opens on central Turin, the area its transit and place data
 * cover. It is a labelled overview, never a claimed device position or route origin.
 */
export const TURIN_OVERVIEW = { center: { latitude: 45.0703, longitude: 7.6869 } as Coordinate, zoom: 11.5 } as const;
/** The camera's starting coordinate; also a placeholder origin before one is chosen. */
export const INITIAL_MAP: Coordinate = TURIN_OVERVIEW.center;
/** Domain coordinate → MapLibre `[longitude, latitude]`. */
export const toMapCoordinate = (coordinate: Coordinate): MapCoordinate => [coordinate.longitude, coordinate.latitude];
/** MapLibre `[longitude, latitude]` → domain coordinate. */
export const toCoordinate = ([longitude, latitude]: MapCoordinate): Coordinate => ({ longitude, latitude });
