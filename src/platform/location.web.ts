import { diagnostics } from '../services/diagnostics';

export class LocationError extends Error {
  constructor(public code: 'denied' | 'unavailable' | 'timeout', message: string) { super(message); this.name = 'LocationError'; }
}
export interface CurrentLocation { coordinate: [number, number]; accuracy: number | null }
export function getCurrentLocation(): Promise<CurrentLocation> {
  diagnostics.record({ type: 'location', state: 'requested' });
  return new Promise<CurrentLocation>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new LocationError('unavailable', 'Posizione non disponibile.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ coordinate: [position.coords.longitude, position.coords.latitude], accuracy: position.coords.accuracy }), error => reject(new LocationError(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable', 'Posizione non disponibile. Puoi cercare sulla mappa.')), { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
  }).then(position => {
    diagnostics.record({ type: 'location', state: 'fix' }); return position;
  }, error => {
    diagnostics.record({ type: 'location', state: error instanceof LocationError ? error.code : 'unavailable' }); throw error;
  });
}
