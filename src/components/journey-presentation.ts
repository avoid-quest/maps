import type { RouteLeg, TransitTime, TravelMode } from '../domain/types';
import { resolveTransitTime, romeDateTime } from '../services/transit-time';

export const journeyTime = (value?: number) => value == null ? 'Orario non disponibile' :
  new Date(value).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
export const journeyDate = (value: number) => new Date(value).toLocaleDateString('it-IT', {
  timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: 'numeric',
});
export function journeyDuration(seconds: number): string {
  if (seconds === 0) return '0 min';
  if (seconds < 60) return 'meno di 1 min';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
export const journeyDistance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
export function nextRomeDate(days: number, now = new Date()): string {
  const date = romeDateTime(now).date;
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
export const italianDate = (iso: string) => iso.split('-').reverse().join('/');

export interface TransitTimeDraft {
  kind: TransitTime['kind']; date: string; time: string; userEdited: boolean;
}
export function createTransitTimeDraft(value: TransitTime, now = new Date()): TransitTimeDraft {
  const civil = value.kind === 'now' ? romeDateTime(now) : value;
  return { kind: value.kind, date: italianDate(civil.date), time: civil.time.slice(0, 5), userEdited: value.kind !== 'now' };
}
type TransitTimeDraftAction =
  | { type: 'kind'; kind: TransitTime['kind']; now: Date }
  | { type: 'date' | 'time'; value: string }
  | { type: 'submitted'; value: TransitTime; now: Date };

export function transitTimeDraftReducer(state: TransitTimeDraft, action: TransitTimeDraftAction): TransitTimeDraft {
  if (action.type === 'submitted') return createTransitTimeDraft(action.value, action.now);
  if (action.type === 'kind') {
    // Refresh automatic defaults when opening the fields; keep deliberate edits
    // through mode toggles until a new "Adesso" search replaces that draft.
    const next = state.kind === 'now' && action.kind !== 'now' && !state.userEdited
      ? createTransitTimeDraft({ kind: 'now' }, action.now) : state;
    return { ...next, kind: action.kind };
  }
  return { ...state, [action.type]: action.value, userEdited: true };
}

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
export function savedJourneyTimeLabel(value: TransitTime, fetchedAt: number, mode: TravelMode = 'transit'): string | null {
  if (mode !== 'transit') return null;
  return value.kind === 'now'
    ? `Partenza richiesta il ${journeyDate(fetchedAt)} alle ${journeyTime(fetchedAt)} (ora della consultazione)`
    : transitTimeLabel(value);
}
export function journeyTimingLabel(leg: RouteLeg, fetchedAt: number, now: number, saved = false): string {
  if (leg.timingStatus === 'cancelled') return 'Corsa cancellata';
  if (leg.timingStatus === 'scheduled') return 'Orario programmato';
  if (leg.timingStatus === 'unknown') return 'Stato dell’orario non disponibile';
  return saved || now - fetchedAt > 120_000 ? 'Previsione MATO da aggiornare' : 'Previsione MATO';
}
export function waitBefore(leg: RouteLeg, previous?: RouteLeg): number {
  return leg.departureAt != null && previous?.arrivalAt != null
    ? Math.max(0, (leg.departureAt - previous.arrivalAt) / 1000) : 0;
}
