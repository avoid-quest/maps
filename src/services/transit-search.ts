import type { Coordinate, Place, Stop } from '../domain/types';
import { catalogStops } from '../transit-data/stop-catalog';
import { distanceMeters, normalize } from './geo';

/** Stops and lines named by a search, from the bundled GTT stop catalog (no request leaves the device). */
export interface TransitSearch {
  /** The stop whose code was typed ("472", "fermata 472"). */
  code: Stop | null;
  /** A line typed by name ("15", "M1", "linea 4") and its stops nearest the reference point. */
  line: { name: string; stops: Stop[] } | null;
  /** Stops whose names contain every typed word, nearest first. */
  named: Stop[];
  /** The query asked for transport explicitly ("fermata …", "linea …"), so these lead the results. */
  explicit: boolean;
}

export const EMPTY_TRANSIT_SEARCH: TransitSearch = { code: null, line: null, named: [], explicit: false };
const STOP_WORDS = new Set(['fermata', 'fermate', 'stop']);
const LINE_WORDS = new Set(['linea', 'linee', 'line', 'bus', 'tram', 'metro']);
/** Nearby stops offered for a line. */
export const LINE_STOP_LIMIT = 3;
const NAMED_LIMIT = 3;

const CODE_OR_LINE = /^(?:\d{1,5}|[a-z]{1,2}\d{1,4}[a-z]?|\d{1,4}[a-z])$/;
/**
 * The query asks for transport and is answered only from the bundled catalog: it starts with a stop
 * or line word ("fermata", "stop", "linea", "bus", "tram", "metro", …) or is one code-or-line-shaped
 * token ("472", "M1", "10N"). Such text never goes to an online geocoder.
 */
export function isTransitQuery(query: string): boolean {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  return STOP_WORDS.has(tokens[0]!) || LINE_WORDS.has(tokens[0]!) || (tokens.length === 1 && CODE_OR_LINE.test(tokens[0]!));
}

const nameWords = (stop: Stop) => normalize(stop.name.replace(/^Fermata\s+\d+\s*-\s*/i, '')).split(' ').filter(Boolean);
const nearest = (stops: readonly Stop[], center: Coordinate, limit: number) => stops
  .map(stop => ({ stop, distance: distanceMeters(center, stop.coordinate) }))
  .sort((a, b) => a.distance - b.distance || a.stop.id.localeCompare(b.stop.id)).slice(0, limit).map(item => item.stop);

export function searchTransit(query: string, center: Coordinate, stops: readonly Stop[] = catalogStops()): TransitSearch {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return EMPTY_TRANSIT_SEARCH;
  const askedStop = STOP_WORDS.has(tokens[0]!);
  const askedLine = LINE_WORDS.has(tokens[0]!);
  const rest = askedStop || askedLine ? tokens.slice(1) : tokens;
  const text = rest.join(' ');
  if (!text) return EMPTY_TRANSIT_SEARCH;
  const code = !askedLine && /^\d{1,5}$/.test(text) ? stops.find(stop => stop.code === text) ?? null : null;
  let line: TransitSearch['line'] = null;
  if (!askedStop && text.length <= 8) {
    const serving = stops.filter(stop => stop.lines.some(name => normalize(name) === text));
    const name = serving[0]?.lines.find(item => normalize(item) === text);
    if (name) line = { name, stops: nearest(serving, center, LINE_STOP_LIMIT) };
  }
  // A bare number is a code or a line, never a fragment of a stop name.
  const named = /^\d+$/.test(text) || text.length < 3 || askedLine ? [] : nearest(stops.filter(stop => {
    const words = nameWords(stop);
    return rest.every(token => words.some(word => word.startsWith(token)));
  }), center, NAMED_LIMIT).filter(stop => stop.id !== code?.id);
  return { code, line, named, explicit: askedStop || askedLine };
}

/** A stop as a route endpoint (the planner plans to and from places). */
export function stopAsPlace(stop: Stop): Place {
  return {
    id: `stop:${stop.id}`, name: stop.name, coordinate: { ...stop.coordinate }, category: 'Fermata GTT',
    address: `Fermata ${stop.code}${stop.lines.length ? ` · linee ${stop.lines.slice(0, 6).join(', ')}` : ''}`,
    source: 'GTT', attributions: ['Dati GTT'],
  };
}

/** Stops a search offers as route endpoints: the typed code, the line's nearest stops, then name matches. */
export function endpointStops(transit: TransitSearch): Stop[] {
  const stops = [...(transit.code ? [transit.code] : []), ...(transit.line?.stops ?? []), ...transit.named];
  return stops.filter((stop, index) => stops.findIndex(other => other.id === stop.id) === index);
}
