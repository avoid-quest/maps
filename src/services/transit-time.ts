import type { TransitTime } from '../domain/types';
import { ServiceError } from './network';

const romeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function romeDateTime(now = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(romeFormatter.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** The provider accepts civil time without an offset; DST folds cannot be disambiguated. */
export function resolveTransitTime(value: TransitTime = { kind: 'now' }, now = new Date()): { date: string; time: string; arriveBy: boolean } {
  const selected = value.kind === 'now' ? romeDateTime(now) : value;
  const { date } = selected;
  const time = /^\d{2}:\d{2}$/.test(selected.time) ? `${selected.time}:00` : selected.time;
  const civil = new Date(`${date}T${time}Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)
    || !Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 19) !== `${date}T${time}`) {
    throw new ServiceError('Inserisci una data valida e un orario nel formato HH:mm.', 'invalid');
  }

  // Gather the offsets on either side of the civil date, then round-trip candidates.
  // This is independent of the device timezone and detects both gaps and folds.
  const offsets = new Set<number>();
  for (const days of [-2, 0, 2]) {
    const instant = civil.getTime() + days * 86_400_000;
    const local = romeDateTime(new Date(instant));
    offsets.add(new Date(`${local.date}T${local.time}Z`).getTime() - instant);
  }
  const matches = [...offsets].filter(offset => {
    const local = romeDateTime(new Date(civil.getTime() - offset));
    return local.date === date && local.time === time;
  });
  if (!matches.length) throw new ServiceError('Orario inesistente per il cambio dell’ora. Scegli un altro orario.', 'invalid');
  if (matches.length > 1) throw new ServiceError('Orario ambiguo per il cambio dell’ora. Scegli prima delle 02:00 o dalle 03:00.', 'invalid');
  return { date, time, arriveBy: value.kind === 'arrive-by' };
}
