/**
 * GTFS service days in Europe/Rome. A GTFS time is seconds after "noon minus
 * 12h" of the service day, so times above 24:00 belong to the previous service
 * day and DST transition days stay correct (23h/25h days).
 */
export type ServiceDate = string; // YYYYMMDD

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function romeParts(epochMs: number) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(epochMs)).map(part => [part.type, part.value]));
  return { date: `${parts.year}${parts.month}${parts.day}`, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
}

/** Rome civil date of an instant. */
export function romeDate(epochMs: number): ServiceDate { return romeParts(epochMs).date; }

export function addDays(date: ServiceDate, days: number): ServiceDate {
  const value = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6) + days));
  return value.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Monday = 0 … Sunday = 6, matching the package weekday mask bits. */
export function weekday(date: ServiceDate): number {
  return (new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6))).getUTCDay() + 6) % 7;
}

/** Rome UTC offset in ms at an instant. */
function offsetAt(epochMs: number): number {
  const { date, hour, minute, second } = romeParts(epochMs);
  const civil = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6), hour, minute, second);
  return civil - Math.floor(epochMs / 1000) * 1000;
}

const origins = new Map<ServiceDate, number>();
/** Epoch ms of GTFS time 0 for a service date: local noon minus 12 hours. */
export function serviceDayOrigin(date: ServiceDate): number {
  const cached = origins.get(date); if (cached !== undefined) return cached;
  const noonUtcGuess = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6), 12);
  // Rome is never on a transition at noon, so one correction is exact.
  const noon = noonUtcGuess - offsetAt(noonUtcGuess - 2 * 3_600_000);
  const origin = noon - 12 * 3_600_000;
  if (origins.size > 64) origins.clear();
  origins.set(date, origin);
  return origin;
}

export function serviceTime(date: ServiceDate, seconds: number): number {
  return serviceDayOrigin(date) + seconds * 1000;
}

export interface CalendarRow { serviceId: string; mask: number; start: string; end: string }
export interface CalendarException { serviceId: string; date: ServiceDate; added: boolean }

/** calendar.txt plus calendar_dates.txt: exceptions win over the weekly pattern. */
export function activeServiceIds(rows: readonly CalendarRow[], exceptions: readonly CalendarException[], date: ServiceDate): Set<string> {
  const active = new Set<string>();
  const bit = 1 << weekday(date);
  for (const row of rows) if (row.mask & bit && row.start <= date && date <= row.end) active.add(row.serviceId);
  for (const exception of exceptions) {
    if (exception.date !== date) continue;
    if (exception.added) active.add(exception.serviceId); else active.delete(exception.serviceId);
  }
  return active;
}

export function withinCoverage(date: ServiceDate, validFrom: ServiceDate, validTo: ServiceDate): boolean {
  return validFrom <= date && date <= validTo;
}

/**
 * The package covers instants from GTFS time 0 of its first service date to the last event of its
 * final service date (overnight trips after 24:00 included). Nothing outside is extrapolated.
 */
export function coverageAt(meta: { validFrom: ServiceDate; validTo: ServiceDate; maxEventSeconds: number }, now: number): 'covered' | 'outside' {
  return now >= serviceDayOrigin(meta.validFrom) && now <= serviceTime(meta.validTo, meta.maxEventSeconds) ? 'covered' : 'outside';
}
