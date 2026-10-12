import { diagnostics } from '../services/diagnostics';
import { createLocationLookup, LocationError, type CurrentLocation } from './location-request';
export { LocationError, type CurrentLocation } from './location-request';

const lookup = createLocationLookup(async request => {
  if (request) return true;
  if (!navigator.permissions) return false;
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; }
  catch { return false; }
}, () => {
  diagnostics.record({ type: 'location', state: 'requested' });
  return new Promise<CurrentLocation>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new LocationError('unavailable', 'Posizione non disponibile.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ coordinate: [position.coords.longitude, position.coords.latitude], accuracy: position.coords.accuracy }), error => reject(new LocationError(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable', 'Posizione non disponibile. Puoi cercare sulla mappa.')), { enableHighAccuracy: false, timeout: 30_000, maximumAge: 60_000 });
  }).then(position => {
    diagnostics.record({ type: 'location', state: 'fix' }); return position;
  }, error => {
    diagnostics.record({ type: 'location', state: error instanceof LocationError ? error.code : 'unavailable' }); throw error;
  });
});
export const getCurrentLocation = lookup.getCurrentLocation;
export const getAuthorizedLocation = lookup.getAuthorizedLocation;
