import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Coordinate, Place, SearchPolicy } from '../../domain/types';
import { searchLocalResult, searchPlaces } from '../../services';
import { searchPreferences } from '../../services/search-preferences';
import { endpointStops, searchTransit, stopAsPlace } from '../../services/transit-search';
import { catalogVersion, subscribeCatalog } from '../../transit-data/stop-catalog';

export interface PlaceLookup {
  places: Place[];
  policy: SearchPolicy;
  searching: boolean;
  error: string;
}
const LIMIT = 10;
const catalogHash = () => catalogVersion().packageHash;

/**
 * The search used to choose a route endpoint: a typed stop code or stop name first, then local
 * places at once and Photon after a pause when online search is allowed. "Solo ricerca locale"
 * (or an unread preference) never sends the text anywhere.
 */
export function usePlaceLookup(query: string, center: Coordinate, active: boolean): PlaceLookup {
  const preference = useSyncExternalStore(searchPreferences.subscribe, searchPreferences.getSnapshot, searchPreferences.getSnapshot);
  const policy: SearchPolicy = preference.ready && preference.preferenceKnown ? preference.policy : 'local-only';
  const text = query.trim();
  const catalog = useSyncExternalStore(subscribeCatalog, catalogHash, catalogHash);
  const stops = useMemo(() => {
    void catalog;
    return text ? endpointStops(searchTransit(text, center)).map(stopAsPlace) : [];
  }, [text, center, catalog]);
  const local = useMemo(() => text.length >= 2 ? searchLocalResult(text, center).places : [], [text, center]);
  const [online, setOnline] = useState<{ key: string; places: Place[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const key = `${policy}:${text}:${center.latitude}:${center.longitude}`;
  useEffect(() => {
    setError('');
    if (!active || text.length < 2 || policy === 'local-only') { setSearching(false); return; }
    const controller = new AbortController();
    const unsubscribe = searchPreferences.subscribe(() => {
      const current = searchPreferences.getSnapshot();
      if (!current.ready || !current.preferenceKnown || current.policy !== policy) controller.abort();
    });
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlaces(text, { center, policy, signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setOnline({ key, places: result.places }); })
        .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Ricerca non disponibile.'); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); unsubscribe(); };
  }, [active, text, center, policy, key]);
  const places = online?.key === key ? online.places : local;
  return { places: useMemo(() => [...stops, ...places].slice(0, LIMIT), [stops, places]), policy, searching, error };
}
