import type { Place, Stop } from '../../domain/types';
import type { TransitSearch } from '../../services/transit-search';

/** One row of the search list: a group heading, a place (venue, address, street, area) or a GTT stop. */
export type SearchRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'place'; key: string; place: Place }
  | { kind: 'stop'; key: string; stop: Stop; line?: string };

/**
 * Orders the list: a typed stop code first, then a typed line's nearby stops, then places; stops
 * found by name follow the places unless the query asked for a stop ("fermata …"). Groups get a
 * heading only when more than one kind is shown.
 */
export function searchRows(places: readonly Place[], transit: TransitSearch): SearchRow[] {
  const lead: SearchRow[] = [];
  if (transit.code) lead.push({ kind: 'stop', key: `code:${transit.code.id}`, stop: transit.code });
  const line: SearchRow[] = transit.line?.stops.length ? [
    { kind: 'section', key: `line:${transit.line.name}`, title: `Linea ${transit.line.name} · fermate vicine` },
    ...transit.line.stops.map(stop => ({ kind: 'stop' as const, key: `line:${transit.line!.name}:${stop.id}`, stop, line: transit.line!.name })),
  ] : [];
  const named: SearchRow[] = transit.named.map(stop => ({ kind: 'stop', key: `named:${stop.id}`, stop }));
  const placeRows: SearchRow[] = places.map(place => ({ kind: 'place', key: `place:${place.id}`, place }));
  const kinds = [lead.length || line.length || named.length, placeRows.length].filter(Boolean).length;
  const heading = (key: string, title: string, rows: SearchRow[]): SearchRow[] =>
    rows.length && kinds > 1 ? [{ kind: 'section', key, title }, ...rows] : rows;
  const stopsFirst = transit.explicit;
  return [
    ...(lead.length ? heading('section:code', 'Fermata', lead) : []),
    ...line,
    ...(stopsFirst ? heading('section:stops', 'Fermate', named) : []),
    ...heading('section:places', 'Luoghi e indirizzi', placeRows),
    ...(stopsFirst ? [] : heading('section:stops', 'Fermate', named)),
  ];
}

/** Results that a user can open (headings excluded). */
export const searchRowCount = (rows: readonly SearchRow[]) => rows.filter(row => row.kind !== 'section').length;

/** Two characters start a search; a one-character stop code or line ("4", "9") also does. */
export const showsSearch = (term: string, transit: TransitSearch) => term.length >= 2 || !!transit.code || !!transit.line;

/**
 * Stops the map pins for a search (every listed stop) and the ones a submitted search frames: the
 * stops that lead the list (code, line, or names after "fermata"), else name matches when no place matched.
 */
export function searchMapStops(transit: TransitSearch, placeCount: number): { pinned: Stop[]; framed: Stop[] } {
  const unique = (stops: Stop[]) => stops.filter((stop, index) => stops.findIndex(other => other.id === stop.id) === index);
  const lead = unique([...(transit.code ? [transit.code] : []), ...(transit.line?.stops ?? [])]);
  const pinned = unique([...lead, ...transit.named]);
  const framed = lead.length ? lead : transit.explicit || !placeCount ? transit.named : [];
  return { pinned, framed };
}
