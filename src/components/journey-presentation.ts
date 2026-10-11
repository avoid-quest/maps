import type { RouteLeg, TransitTime } from '../domain/types';
import { resolveTransitTime, romeDateTime } from '../services/transit-time';

export const journeyTime = (value?: number) => value == null ? 'Orario non disponibile' :
  new Date(value).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
export const journeyDate = (value: number) => new Date(value).toLocaleDateString('it-IT', {
  timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: 'numeric',
});
export const journeyDuration = (seconds: number) => seconds === 0 ? '0 min' : seconds < 60 ? 'meno di 1 min' : seconds < 3600
  ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
export const journeyDistance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
export function nextRomeDate(days: number, now = new Date()): string {
  const date = romeDateTime(now).date;
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
export const italianDate = (iso: string) => iso.split('-').reverse().join('/');
export function draftTransitTime(kind: TransitTime['kind'], date: string, time: string): TransitTime {
  if (kind === 'now') return { kind };
  const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(date) ? date.split('/').reverse().join('-') : '';
  const value: TransitTime = { kind, date: iso, time };
  resolveTransitTime(value);
  return value;
}
export function transitTimeLabel(value: TransitTime): string {
  return value.kind === 'now' ? 'Partenza adesso' :
    `${value.kind === 'arrive-by' ? 'Arrivo entro' : 'Partenza alle'} ${value.time.slice(0, 5)} del ${italianDate(value.date)}`;
}
export function journeyTimingLabel(leg: RouteLeg, fetchedAt: number, now: number): string {
  if (leg.timingStatus === 'cancelled') return 'Corsa cancellata';
  if (leg.timingStatus === 'scheduled') return 'Orario programmato';
  if (leg.timingStatus === 'unknown') return 'Stato dell’orario non disponibile';
  return now - fetchedAt > 120_000 ? 'Previsione MATO da aggiornare' : 'Previsione MATO';
}
export function waitBefore(leg: RouteLeg, previous?: RouteLeg): number {
  return leg.departureAt != null && previous?.arrivalAt != null
    ? Math.max(0, (leg.departureAt - previous.arrivalAt) / 1000) : 0;
}
