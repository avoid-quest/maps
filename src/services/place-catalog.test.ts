import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../data/manifest.json';
import { createPlaceCatalog, placeCatalog } from './place-catalog';

function fixture() {
  return {
    schemaVersion: 1, release: '2026-09-23.1', count: 1, bounds: [7.6, 45, 7.77, 45.14], inputSha256: '0'.repeat(64),
    columns: ['id', 'name', 'latitude', 'longitude', 'categoryRef', 'confidence', 'operatingStatus', 'address', 'website', 'phone', 'sourceRefs'],
    categories: [['pharmacy', ['shopping', 'pharmacy']]],
    sourceTemplates: [
      { dataset: 'Source A', license: 'CC0-1.0', update_time: '2026-01-02T00:00:00Z', extra: { labels: ['original'] } },
      { dataset: 'Source B', license: 'Apache-2.0', update_time: null },
    ],
    sources: [[0, 'source-record', 0.8], [1, null, null, 0]],
    places: [['id-a', 'Farmacia di prova', 45.0937, 7.6832, 0, null, null, null, null, '011123456', [0, 1], 5]],
  };
}

test('materialization preserves exact coordinates, raw provenance, source dates and null versus missing fields', () => {
  const catalog = createPlaceCatalog(fixture());
  const place = catalog.materialize('overture:id-a')!;
  assert.deepEqual(place.coordinate, { latitude: 45.0937, longitude: 7.6832 });
  assert.equal(place.address, null);
  assert.equal(Object.hasOwn(place, 'website'), false);
  assert.equal(place.phone, '011123456');
  assert.equal(place.confidence, null);
  assert.equal(place.operatingStatus, null);
  assert.equal(place.dataUpdatedAt, '2026-01-02T00:00:00Z');
  assert.deepEqual(place.attributions, ['Source A · CC0-1.0', 'Source B · Apache-2.0']);
  assert.deepEqual(place.provenance, [
    { dataset: 'Source A', license: 'CC0-1.0', update_time: '2026-01-02T00:00:00Z', extra: { labels: ['original'] }, record_id: 'source-record', confidence: 0.8 },
    { dataset: 'Source B', license: 'Apache-2.0', update_time: null },
  ]);
  assert.equal(catalog.materialize('missing'), undefined);
});

test('search entries omit full provenance and returned records cannot mutate later materializations', () => {
  const catalog = createPlaceCatalog(fixture());
  assert.equal(Object.hasOwn(catalog.entries[0]!, 'provenance'), false);
  assert.equal(Object.hasOwn(catalog.entries[0]!, 'dataUpdatedAt'), false);
  const first = catalog.materialize('overture:id-a')!;
  const original = catalog.materialize('overture:id-a')!;
  first.coordinate.latitude = 0;
  first.hierarchy.push('changed');
  first.attributions.push('changed');
  (first.provenance[0]!.extra as { labels: string[] }).labels.push('changed');
  assert.deepEqual(catalog.materialize('overture:id-a'), original);
});

function correctedFixture() {
  return {
    ...fixture(),
    phoneOverrides: {
      schemaVersion: 1, version: '2026-10-11.1', sha256: '1'.repeat(64), recordCount: 1,
      records: [{
        id: 'overture:id-a', field: 'phone', originalValue: 'old phone', value: '011123456',
        url: 'https://example.org/', checkedAt: '2026-10-11T17:21:16.988772+00:00', reason: 'First-party branch contact.',
      }],
    },
  };
}

test('a reviewed phone correction remains distinct from original provenance and its source timestamp', () => {
  const value = correctedFixture();
  const catalog = createPlaceCatalog(value);
  const details = catalog.materialize('overture:id-a')!;
  const { id: _, ...correction } = value.phoneOverrides.records[0]!;
  assert.deepEqual(details.fieldCorrections, [correction]);
  assert.equal(details.phone, '011123456');
  assert.equal(details.dataUpdatedAt, '2026-01-02T00:00:00Z');
  assert.deepEqual(details.provenance, createPlaceCatalog(fixture()).materialize('overture:id-a')!.provenance);
  assert.equal(details.attributions.at(-1), 'Telefono corretto da sito ufficiale · https://example.org/ · 2026-10-11');
  assert.deepEqual(catalog.entries[0]?.attributions, details.attributions);
  details.fieldCorrections![0]!.value = 'changed';
  assert.deepEqual(catalog.materialize('overture:id-a')?.fieldCorrections, [correction]);
});

test('phone correction headers, duplicate or missing targets and mismatched values are rejected', () => {
  const mutations: ((value: ReturnType<typeof correctedFixture>) => void)[] = [
    (v) => { v.phoneOverrides.schemaVersion = 2; },
    (v) => { v.phoneOverrides.sha256 = 'invalid'; },
    (v) => { v.phoneOverrides.recordCount = 2; },
    (v) => { v.phoneOverrides.records[0]!.id = 'overture:missing'; },
    (v) => { v.phoneOverrides.records[0]!.value = 'different phone'; },
    (v) => { v.phoneOverrides.records[0]!.field = 'address'; },
    (v) => { v.phoneOverrides.records[0]!.checkedAt = 'invalid'; },
    (v) => { v.phoneOverrides.records.push(v.phoneOverrides.records[0]!); v.phoneOverrides.recordCount = 2; },
  ];
  for (const mutate of mutations) {
    const value = correctedFixture(); mutate(value);
    assert.throws(() => createPlaceCatalog(value), /Pacchetto dei luoghi non valido/);
  }
});

test('malformed versions, columns, references, IDs and coordinates are rejected before search', () => {
  const mutations: ((value: ReturnType<typeof fixture>) => void)[] = [
    (v) => { v.schemaVersion = 2; },
    (v) => { v.columns[2] = 'longitude'; },
    (v) => { v.count = 2; },
    (v) => { v.places[0]![4] = 50; },
    (v) => { v.places[0]![10] = [50]; },
    (v) => { v.sources[0]![0] = -1; },
    (v) => { v.sources[0]![3] = 4; },
    (v) => { v.places[0]![11] = 8; },
    (v) => { v.places.push([...v.places[0]!]); v.count = 2; },
    (v) => { v.places[0]![2] = 0; },
    (v) => { v.places[0]![3] = Number.NaN; },
    (v) => { v.places[0]![6] = 'permanently_closed'; },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    assert.throws(() => createPlaceCatalog(value), /Pacchetto dei luoghi non valido/);
  }
});

test('packaged catalog agrees with public coverage metadata and retains original source timestamps', () => {
  assert.equal(placeCatalog.metadata.count, manifest.places.count);
  assert.equal(placeCatalog.metadata.release, manifest.places.release);
  assert.deepEqual(placeCatalog.metadata.bounds, manifest.places.bounds);
  const amen = placeCatalog.entries.find((place) => place.name === 'Amen Bar')!;
  assert.ok(amen);
  const details = placeCatalog.materialize(amen.id)!;
  assert.ok(details.provenance.length);
  assert.ok(details.dataUpdatedAt);
  assert.ok(details.attributions.length);
});
