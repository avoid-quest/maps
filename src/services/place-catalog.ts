import packedPlaces from '../data/places.compact.json';
import type { Place, PlaceCoverage, PlaceFieldCorrection } from '../domain/types';

const COLUMNS = ['id', 'name', 'latitude', 'longitude', 'categoryRef', 'confidence', 'operatingStatus', 'address', 'website', 'phone', 'sourceRefs'];
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type SourceTemplate = { [key: string]: JsonValue };
type Category = [string | null, string[]];
type Source = [number, string | null, number | null, number?];
type Row = [string, string, number, number, number, number | null, string | null, string | null, string | null, string | null, number[], number?];

export type PlaceSearchEntry = Readonly<Omit<Place, 'coordinate' | 'attributions' | 'fieldCorrections'>> & {
  readonly coordinate: Readonly<Place['coordinate']>;
  readonly hierarchy: readonly string[];
  readonly attributions: readonly string[];
};
export interface CatalogPlace extends Place { hierarchy: string[]; provenance: SourceTemplate[] }
export interface PlaceCatalog {
  readonly entries: readonly PlaceSearchEntry[];
  readonly metadata: Readonly<{ release: string; bounds: Readonly<PlaceCoverage['bounds']>; count: number; inputSha256: string }>;
  /** Decode a fresh complete record; callers cannot mutate the package through the returned object. */
  materialize(id: string): CatalogPlace | undefined;
}

function invariant(condition: unknown): asserts condition {
  if (!condition) throw new Error('Pacchetto dei luoghi non valido.');
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function textOrNull(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function numberOrNull(value: unknown): value is number | null { return value === null || (typeof value === 'number' && Number.isFinite(value)); }
function reference(value: unknown, size: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < size;
}
function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return object(value) && Object.values(value).every(jsonValue);
}
function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)])) as T;
  }
  return value;
}
function contactMask(row: Row): number {
  return row[11] ?? ((row[7] === null ? 0 : 1) | (row[8] === null ? 0 : 2) | (row[9] === null ? 0 : 4));
}
function contacts(row: Row): Pick<Place, 'address' | 'website' | 'phone'> {
  const mask = contactMask(row);
  return {
    ...(mask & 1 ? { address: row[7] } : {}),
    ...(mask & 2 ? { website: row[8] } : {}),
    ...(mask & 4 ? { phone: row[9] } : {}),
  };
}
function phoneCorrections(value: unknown): Map<string, PlaceFieldCorrection> {
  const corrections = new Map<string, PlaceFieldCorrection>();
  if (value === undefined) return corrections;
  invariant(object(value) && value.schemaVersion === 1 && typeof value.version === 'string' && value.version.length > 0);
  invariant(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && Array.isArray(value.records) && value.recordCount === value.records.length);
  const keys = ['id', 'field', 'originalValue', 'value', 'url', 'checkedAt', 'reason'];
  for (const record of value.records) {
    invariant(object(record) && Object.keys(record).length === keys.length && keys.every((key) => typeof record[key] === 'string' && (record[key] as string).trim().length > 0));
    invariant(record.field === 'phone' && !corrections.has(record.id as string));
    invariant(Number.isFinite(Date.parse(record.checkedAt as string)) && /^https:\/\/[^/]+/.test(record.url as string));
    const { id, field, originalValue, value: replacement, url, checkedAt, reason } = record as unknown as PlaceFieldCorrection & { id: string };
    corrections.set(id, { field, originalValue, value: replacement, url, checkedAt, reason });
  }
  return corrections;
}
function correctionAttribution(correction: PlaceFieldCorrection): string {
  return `Telefono corretto da sito ufficiale · ${correction.url} · ${correction.checkedAt.slice(0, 10)}`;
}

/**
 * On success, takes ownership of retained compact rows and dictionaries: callers must not mutate
 * those inputs afterward. Exposed catalog values are frozen; materialized details are fresh copies.
 */
export function createPlaceCatalog(value: unknown): PlaceCatalog {
  invariant(object(value) && value.schemaVersion === 1);
  invariant(Array.isArray(value.columns) && value.columns.length === COLUMNS.length && value.columns.every((column, i) => column === COLUMNS[i]));
  invariant(typeof value.release === 'string' && value.release.length > 0);
  invariant(typeof value.inputSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.inputSha256));
  invariant(Array.isArray(value.bounds) && value.bounds.length === 4 && value.bounds.every((n) => typeof n === 'number' && Number.isFinite(n)));
  const bounds = value.bounds as PlaceCoverage['bounds'];
  const [west, south, east, north] = bounds;
  invariant(west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north);
  invariant(Array.isArray(value.categories) && Array.isArray(value.sourceTemplates) && Array.isArray(value.sources) && Array.isArray(value.places));
  invariant(Number.isInteger(value.count) && value.count === value.places.length);
  for (const category of value.categories) {
    invariant(Array.isArray(category) && category.length === 2 && textOrNull(category[0]) && Array.isArray(category[1]) && category[1].every((item: unknown) => typeof item === 'string'));
  }
  for (const template of value.sourceTemplates) {
    invariant(object(template) && jsonValue(template) && !('record_id' in template) && !('confidence' in template));
    invariant(typeof template.dataset === 'string' && template.dataset.length > 0 && typeof template.license === 'string' && template.license.length > 0);
    invariant(template.update_time === undefined || textOrNull(template.update_time));
  }
  for (const source of value.sources) {
    invariant(Array.isArray(source) && (source.length === 3 || source.length === 4));
    invariant(reference(source[0], value.sourceTemplates.length) && textOrNull(source[1]) && numberOrNull(source[2]));
    const mask: unknown = source.length === 3 ? 3 : source[3];
    invariant(typeof mask === 'number' && Number.isInteger(mask) && mask >= 0 && mask <= 3);
    invariant((mask & 1 || source[1] === null) && (mask & 2 || source[2] === null));
  }
  const categories = value.categories as Category[];
  const templates = value.sourceTemplates as SourceTemplate[];
  const sources = value.sources as Source[];
  const corrections = phoneCorrections(value.phoneOverrides);
  const rows = new Map<string, Row>();
  const attributionLists = new Map<string, readonly string[]>();
  const entries: PlaceSearchEntry[] = [];
  for (const candidate of value.places) {
    invariant(Array.isArray(candidate) && (candidate.length === 11 || candidate.length === 12));
    invariant(typeof candidate[0] === 'string' && candidate[0].length > 0 && typeof candidate[1] === 'string' && candidate[1].trim().length > 0);
    invariant(typeof candidate[2] === 'number' && Number.isFinite(candidate[2]) && candidate[2] >= south && candidate[2] <= north);
    invariant(typeof candidate[3] === 'number' && Number.isFinite(candidate[3]) && candidate[3] >= west && candidate[3] <= east);
    invariant(reference(candidate[4], categories.length) && numberOrNull(candidate[5]) && textOrNull(candidate[6]) && candidate[6] !== 'permanently_closed');
    invariant(candidate.slice(7, 10).every(textOrNull) && Array.isArray(candidate[10]) && candidate[10].every((ref: unknown) => reference(ref, sources.length)));
    invariant(candidate.length === 11 || (Number.isInteger(candidate[11]) && candidate[11] >= 0 && candidate[11] <= 7));
    const row = candidate as Row;
    const mask = contactMask(row);
    invariant((mask & 1 || row[7] === null) && (mask & 2 || row[8] === null) && (mask & 4 || row[9] === null));
    const id = `overture:${row[0]}`;
    invariant(!rows.has(id));
    rows.set(id, row);
    const [category, hierarchy] = categories[row[4]]!;
    const notices = row[10].map((ref) => {
      const template = templates[sources[ref]![0]]!;
      return `${template.dataset} · ${template.license}`;
    });
    const correction = corrections.get(id);
    if (correction) {
      invariant((mask & 4) && row[9] === correction.value);
      notices.push(correctionAttribution(correction));
    }
    const key = JSON.stringify(notices);
    const attributions = attributionLists.get(key) ?? Object.freeze(notices);
    attributionLists.set(key, attributions);
    entries.push(Object.freeze({ id, name: row[1], coordinate: Object.freeze({ latitude: row[2], longitude: row[3] }), category, hierarchy,
      confidence: row[5], source: 'Overture Places', attributions, ...contacts(row) }));
  }
  invariant([...corrections.keys()].every((id) => rows.has(id)));
  for (const [, hierarchy] of categories) Object.freeze(hierarchy);
  return Object.freeze({
    entries: Object.freeze(entries),
    metadata: Object.freeze({ release: value.release, bounds: Object.freeze([...bounds] as PlaceCoverage['bounds']), count: entries.length, inputSha256: value.inputSha256 }),
    materialize(id: string) {
      const row = rows.get(id);
      if (!row) return undefined;
      const [category, hierarchy] = categories[row[4]]!;
      const correction = corrections.get(id);
      const provenance: SourceTemplate[] = row[10].map((ref) => {
        const [templateRef, recordId, confidence, mask = 3] = sources[ref]!;
        const source = cloneJson(templates[templateRef]!);
        if (mask & 1) source.record_id = recordId;
        if (mask & 2) source.confidence = confidence;
        return source;
      });
      return {
        id, name: row[1], coordinate: { latitude: row[2], longitude: row[3] }, category, hierarchy: [...hierarchy],
        confidence: row[5], operatingStatus: row[6], ...contacts(row), source: 'Overture Places', provenance,
        attributions: [...provenance.map((source) => `${source.dataset} · ${source.license}`), ...(correction ? [correctionAttribution(correction)] : [])],
        dataUpdatedAt: provenance.reduce((latest, source) => typeof source.update_time === 'string' && source.update_time > latest ? source.update_time : latest, ''),
        ...(correction ? { fieldCorrections: [{ ...correction }] } : {}),
      };
    },
  });
}

export const placeCatalog = createPlaceCatalog(packedPlaces);
