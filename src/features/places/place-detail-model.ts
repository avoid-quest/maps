import type { Place } from '../../domain/types';

/** A website as people read it: no scheme, "www." or trailing slash. */
export function websiteLabel(url: string): string {
  return url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/** An upstream date shown as written (dd/mm/yyyy of its date part); no timezone conversion is implied. */
export function sourceDate(value: unknown): string | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

const FIELD_LABELS: Record<string, string> = {
  confidence: 'affidabilità', websites: 'sito web', phones: 'telefono', addresses: 'indirizzo', names: 'nome',
  categories: 'categoria', taxonomy: 'categoria', brand: 'marchio', emails: 'email', socials: 'profili social', operating_status: 'stato',
};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** One line per contributing source record, with the field it supplied, its licence and its own date. */
export function sourceLines(place: Pick<Place, 'provenance' | 'attributions'>): string[] {
  if (!place.provenance?.length) return [...place.attributions];
  const lines = place.provenance.map(source => {
    const property = text(source.property)?.replace(/^\/properties\//, '').split('/')[0];
    const date = sourceDate(source.update_time);
    return [
      `${text(source.dataset) ?? 'Fonte'}${property ? ` (${FIELD_LABELS[property] ?? property})` : ''}`,
      text(source.license), date ? `aggiornato il ${date}` : 'data non indicata',
    ].filter(Boolean).join(' · ');
  });
  // Notices that are not source records (such as a checked phone correction) stay listed too.
  const datasets = new Set(place.provenance.map(source => `${text(source.dataset)} · ${text(source.license)}`));
  return [...new Set([...lines, ...place.attributions.filter(notice => !datasets.has(notice))])];
}

/** The freshest date any source states for the record, or an explicit absence. */
export function freshnessLabel(place: Pick<Place, 'dataUpdatedAt'>): string {
  const date = sourceDate(place.dataUpdatedAt);
  return date ? `Ultimo aggiornamento indicato dalle fonti: ${date}` : 'Data di aggiornamento non indicata dalla fonte';
}

/** Overture's confidence estimates that the place exists; it never means "open now". */
export function confidenceLabel(place: Pick<Place, 'confidence' | 'source'>): string | null {
  if (typeof place.confidence !== 'number' || !Number.isFinite(place.confidence) || !place.source.startsWith('Overture')) return null;
  return `Esistenza stimata da Overture: ${Math.round(place.confidence * 100)}% (non indica se è aperto ora)`;
}
