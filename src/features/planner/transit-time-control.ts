import type { TransitTime } from '../../domain/types';
import { romeDateTime } from '../../services/transit-time';
import { draftTransitTime, italianDate, nextRomeDate } from './journey-presentation';

/** Partenza or Arrivo; "now" is a departure. */
export type TimeDirection = 'depart' | 'arrive';
export const timeDirection = (value: TransitTime): TimeDirection => value.kind === 'arrive-by' ? 'arrive' : 'depart';

const DAY_LABELS = ['oggi', 'domani'];
/** "oggi", "domani" or a short Italian date such as "gio 14 ott", always for the Rome civil date. */
export function romeDayLabel(isoDate: string, now = new Date()): string {
  const index = [0, 1].findIndex(days => nextRomeDate(days, now) === isoDate);
  if (index >= 0) return DAY_LABELS[index]!;
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

/** The chip: "Partenza adesso", "Partenza 17:45 · domani", "Arrivo entro 09:00 · gio 14 ott". */
export function timeChipLabel(value: TransitTime, now = new Date()): string {
  if (value.kind === 'now') return 'Partenza adesso';
  const day = romeDayLabel(value.date, now);
  return `${value.kind === 'arrive-by' ? 'Arrivo entro' : 'Partenza'} ${value.time.slice(0, 5)}${day === 'oggi' ? '' : ` · ${day}`}`;
}

/** The civil date and minute a choice starts from: the chosen one, or the current Rome minute. */
function civil(value: TransitTime, now: Date): { date: string; time: string } {
  if (value.kind !== 'now') return { date: value.date, time: value.time.slice(0, 5) };
  const current = romeDateTime(now);
  return { date: current.date, time: current.time.slice(0, 5) };
}
const build = (kind: 'depart-at' | 'arrive-by', date: string, time: string) => draftTransitTime(kind, italianDate(date), time);

/** Switches between Partenza and Arrivo, keeping the chosen date and time (from "now", the current minute). */
export function withDirection(value: TransitTime, direction: TimeDirection, now = new Date()): TransitTime {
  if (timeDirection(value) === direction && value.kind !== 'now') return value;
  const { date, time } = civil(value, now);
  return build(direction === 'arrive' ? 'arrive-by' : 'depart-at', date, time);
}

/** A picked Rome date or time replaces that part; validation rejects nonexistent or ambiguous DST minutes. */
export function withCivilChange(value: TransitTime, change: { date?: string; time?: string }, direction = timeDirection(value), now = new Date()): TransitTime {
  const current = civil(value, now);
  return build(direction === 'arrive' ? 'arrive-by' : 'depart-at', change.date ?? current.date, change.time ?? current.time);
}

/** The instant whose Rome civil time is `date time` (the earlier one in a fold, the shifted one in a gap). */
export function romeInstant(date: string, time: string): Date {
  const utc = new Date(`${date}T${time.slice(0, 5)}:00Z`).getTime();
  for (const offset of [60, 120]) {
    const candidate = new Date(utc - offset * 60_000);
    const local = romeDateTime(candidate);
    if (local.date === date && local.time.slice(0, 5) === time.slice(0, 5)) return candidate;
  }
  return new Date(utc - 60 * 60_000);
}
/** The instant the native pickers open on. */
export function pickerValue(value: TransitTime, now = new Date()): Date {
  if (value.kind === 'now') return now;
  return romeInstant(value.date, value.time);
}
/** What a native picker returned, read as a Rome civil date and minute. */
export function pickedCivil(picked: Date): { date: string; time: string } {
  const local = romeDateTime(picked);
  return { date: local.date, time: local.time.slice(0, 5) };
}
