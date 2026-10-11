import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';

export class LocationError extends Error {
  constructor(public code: 'denied' | 'unavailable' | 'timeout', message: string) { super(message); this.name = 'LocationError'; }
}
export interface CurrentLocation { coordinate: [number, number]; accuracy: number | null }
let pending: Promise<CurrentLocation> | undefined;
export function getCurrentLocation(): Promise<CurrentLocation> {
  if (!pending) pending = locate().finally(() => { pending = undefined; });
  return pending;
}
async function locate(): Promise<CurrentLocation> {
  if (Platform.OS === 'android') {
    const results = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]);
    if (results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED && results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) throw new LocationError('denied', 'Posizione non autorizzata. Puoi comunque cercare sulla mappa.');
  } else if (!await LocationManager.requestPermissions()) throw new LocationError('denied', 'Posizione non autorizzata.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (position?: GeolocationPosition, error?: LocationError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); subscription.remove(); LocationManager.removeListener(listener);
      if (error) reject(error);
      else if (position) resolve({ coordinate: [position.coords.longitude, position.coords.latitude], accuracy: position.coords.accuracy ?? null });
    };
    const listener = (position: GeolocationPosition) => {
      if (Date.now() - position.timestamp < 60_000 && Number.isFinite(position.coords.longitude) && Number.isFinite(position.coords.latitude)) finish(position);
    };
    const timer = setTimeout(() => finish(undefined, new LocationError('timeout', 'Posizione non disponibile. Riprova all’aperto oppure scegli un punto sulla mappa.')), 20_000);
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') finish(undefined, new LocationError('unavailable', 'Richiesta posizione interrotta.')); });
    LocationManager.addListener(listener);
    LocationManager.getCurrentPosition().then(position => { if (position) listener(position); }).catch(() => {});
  });
}
