/** Foreground lookup shared by manual Locate and an already-authorized launch. */
export interface CurrentLocation { coordinate: [number, number]; accuracy: number | null }
export class LocationError extends Error {
  constructor(public code: 'denied' | 'unavailable' | 'timeout', message: string) { super(message); this.name = 'LocationError'; }
}
export interface LocationSample {
  timestamp: number;
  coords: { longitude: number; latitude: number; accuracy?: number | null };
}
interface LocationSource {
  addListener(listener: (position: LocationSample) => void): void;
  removeListener(listener: (position: LocationSample) => void): void;
  getCurrentPosition(): Promise<LocationSample | undefined>;
}
export function waitForLocation(source: LocationSource, onInactive: (listener: () => void) => () => void, timeoutMs = 30_000): Promise<CurrentLocation> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeActivity = () => {};
    const finish = (position?: LocationSample, error?: LocationError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); removeActivity(); source.removeListener(listener);
      if (error) reject(error);
      else if (position) resolve({ coordinate: [position.coords.longitude, position.coords.latitude], accuracy: position.coords.accuracy ?? null });
    };
    const listener = (position: LocationSample) => {
      const age = Date.now() - position.timestamp;
      const { longitude, latitude } = position.coords;
      if (age >= 0 && age < 60_000 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 && Number.isFinite(latitude) && Math.abs(latitude) <= 90) finish(position);
    };
    const timer = setTimeout(() => finish(undefined, new LocationError('timeout', 'Posizione non ancora disponibile. Riprova all’aperto oppure scegli un punto sulla mappa.')), timeoutMs);
    removeActivity = onInactive(() => finish(undefined, new LocationError('unavailable', 'Richiesta posizione interrotta.')));
    if (settled) { removeActivity(); return; }
    try {
      source.addListener(listener);
      if (!settled) source.getCurrentPosition().then(position => { if (position) listener(position); }).catch(() => {});
    } catch {
      finish(undefined, new LocationError('unavailable', 'Posizione non disponibile. Riprova oppure scegli un punto sulla mappa.'));
    }
  });
}

export function createLocationLookup(authorize: (request: boolean) => Promise<boolean>, acquire: () => Promise<CurrentLocation>) {
  let pending: Promise<CurrentLocation> | undefined;
  const lookup = async (request: boolean) => {
    if (!await authorize(request)) {
      if (!request) return null;
      throw new LocationError('denied', 'Posizione non autorizzata. Puoi comunque cercare sulla mappa.');
    }
    pending ??= acquire().finally(() => { pending = undefined; });
    return pending;
  };
  return {
    getCurrentLocation: () => lookup(true) as Promise<CurrentLocation>,
    getAuthorizedLocation: () => lookup(false),
  };
}
