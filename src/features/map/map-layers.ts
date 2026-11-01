import type { Place, Stop } from '../../domain/types';
import { tuple } from './coordinates';
import type { MapMarker } from './MapCanvas.types';

export const placeMarker = (place: Place): MapMarker => ({ id: place.id, coordinate: tuple(place.coordinate), kind: 'place', label: place.name });
export const stopMarker = (stop: Stop): MapMarker => ({ id: stop.id, coordinate: tuple(stop.coordinate), kind: 'stop', label: stop.name });

/** A selected place or open stop replaces list pins with its own pin. */
export function taskMarkers(listed: MapMarker[], selected: Place | null, board: Stop | null): MapMarker[] {
  const markers = selected || board ? [] : [...listed];
  if (selected && !markers.some(item => item.id === selected.id)) markers.push(placeMarker(selected));
  if (board && !markers.some(item => item.id === board.id)) markers.push(stopMarker(board));
  return markers;
}
