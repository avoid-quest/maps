import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Place } from '../domain/types';
import { validCoordinate } from './geo';
import { ServiceError } from './network';
import { diagnostics } from './diagnostics';
const KEY = '@avoid-maps/favorites-v1'; let pending: Promise<unknown> = Promise.resolve();
export async function loadSavedPlaces(): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY); if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid favorites');
    return value.filter((v): v is Place => v && typeof v.id === 'string' && typeof v.name === 'string' && v.coordinate && validCoordinate(v.coordinate) && typeof v.source === 'string' && Array.isArray(v.attributions));
  } catch { diagnostics.record({ type: 'favorites', state: 'read-failed' }); throw new ServiceError('Impossibile leggere i preferiti salvati sul telefono.'); }
}
function mutate(change: (places: Place[]) => Place[]): Promise<Place[]> {
  const task = pending.catch(() => undefined).then(async () => {
    const next = change(await loadSavedPlaces());
    try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { diagnostics.record({ type: 'favorites', state: 'write-failed' }); throw new ServiceError('Impossibile salvare i preferiti sul telefono.'); }
    return next;
  }); pending = task; return task;
}
export function savePlace(place: Place): Promise<Place[]> { return mutate(places => [place, ...places.filter(p => p.id !== place.id)]); }
export function removeSavedPlace(id: string): Promise<Place[]> { return mutate(places => places.filter(p => p.id !== id)); }
