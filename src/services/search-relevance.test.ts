import test from "node:test";
import assert from "node:assert/strict";
import { searchLocalPlaces, searchLocalResult, searchPlaces, categoryLabel, createLocalPlaceSearch } from "./search";
import { createPlaceCatalog, placeCatalog, type PlaceCatalog, type CatalogPlace, type PlaceSearchEntry } from './place-catalog';
const docks = { latitude: 45.0937, longitude: 7.6832 };

test("food intent includes actual restaurants and excludes their furniture supplier", () => {
  const food = searchLocalPlaces("ristoranti", docks);
  assert.ok(food.some((place) => place.name === "Amen Bar"));
  assert.ok(food.some((place) => /Burgheria/.test(place.name)));
  assert.ok(!food.some((place) => /Arredamenti per Negozi/.test(place.name)));
});
test("venue tokens do not match fragments inside unrelated business words", () => {
  const amen = searchLocalPlaces("Amen", docks);
  assert.equal(amen[0]?.name, "Amen Bar");
  assert.ok(
    !amen.some((place) =>
      /Arredamenti|Abbigliamento|Serramenti/.test(place.name),
    ),
  );
});
test("category discovery is local and does not invent nearby results outside its data area", async () => {
  const rome = { latitude: 41.9028, longitude: 12.4964 };
  const result = await searchPlaces("ristoranti", { center: rome });
  assert.equal(result.places.length, 0);
  assert.equal(result.coverage.extent, "outside");
  assert.equal(result.coverage.radiusMeters, 5000);
});

test("plural and everyday Italian category aliases use taxonomy rather than supplier names", () => {
  const pharmacies = searchLocalPlaces("farmacie", docks);
  assert.ok(pharmacies.length > 0);
  assert.ok(pharmacies.every((place) => place.category === "pharmacy"));
  assert.ok(!pharmacies.some((place) => /Arredamenti/.test(place.name)));
  assert.deepEqual(pharmacies.map((place) => place.id), searchLocalPlaces("farmacia", docks).map((place) => place.id));
  assert.ok(searchLocalPlaces("alimentari", docks).some((place) => place.category === "grocery_store"));
  assert.ok(searchLocalPlaces("ferramenta", docks).some((place) => place.category === "hardware_store"));
  assert.deepEqual(searchLocalPlaces("pizzerie", docks), searchLocalPlaces("pizzeria", docks));
});

test("the pharmacy category excludes the combined drugstore family without hiding exact business names", () => {
  const personalCare = searchLocalPlaces("dm Drogerie Markt", docks)[0];
  assert.equal(personalCare?.name, "dm - Drogerie Markt");
  assert.equal(personalCare.category, "drugstore");
  assert.equal(categoryLabel(personalCare.category), "Cura della persona");
  assert.ok(!searchLocalPlaces("farmacie", docks).some((place) => place.id === personalCare.id));
  // A name containing Farmacia is not enough to override the source's broader category.
  const broader = searchLocalPlaces("Farmacia Granero", docks)[0];
  assert.equal(broader?.category, "drugstore");
  assert.ok(!searchLocalPlaces("farmacie", docks).some((place) => place.id === broader.id));
});

test("local names tolerate one edit or adjacent transposition while exact and prefix names rank first", () => {
  // Wider coverage includes a genuine Amnesia prefix match; exact/prefix results must precede typos.
  const amne = searchLocalPlaces("Amne", docks);
  const prefixRank = amne.findIndex((place) => place.name === "Amnesia Preziosi");
  const typoRank = amne.findIndex((place) => place.name === "Amen Bar");
  assert.ok(prefixRank >= 0 && typoRank > prefixRank);
  assert.equal(searchLocalPlaces("Amen Bar", docks)[0]?.name, "Amen Bar");
  assert.equal(searchLocalPlaces("AMÉN", docks)[0]?.name, "Amen Bar");
  assert.ok(searchLocalPlaces("Hangra 107", docks).some((place) => /Hangar 107/i.test(place.name)));
  for (const query of ["Hangra 10", "Hangra 1", "Hangar 108", "Hangar 10", "Hangar 1"]) {
    assert.ok(!searchLocalPlaces(query, docks).some((place) => /Hangar 107/i.test(place.name)), query);
  }
  assert.ok(!searchLocalPlaces("Amn", docks).some((place) => place.name === "Amen Bar"));
  assert.ok(!searchLocalPlaces("Amxx", docks).some((place) => place.name === "Amen Bar"));
});

test("address numbers match exactly while textual prefixes still find a numbered address", () => {
  const pharmacy = searchLocalPlaces("Farmacia Dora", docks)[0];
  assert.equal(pharmacy?.address, "VIA FRANCESCO CIGNA 118, TORINO");
  assert.ok(searchLocalPlaces("Cign 118", docks).some((place) => place.id === pharmacy.id));
  for (const query of ["Cigna 11", "Cigna 1", "Cigna 119"]) {
    assert.ok(!searchLocalPlaces(query, docks).some((place) => place.id === pharmacy.id), query);
  }
});

test("nonempty category results disclose partial package coverage at the extraction edge", () => {
  const result = searchLocalResult("ristoranti", { latitude: 45.07, longitude: 7.768 });
  assert.ok(result.places.length > 0);
  assert.equal(result.coverage.extent, "partial");
  assert.equal(result.coverage.centerInside, true);
  assert.equal(result.resultLimit, 60);
  assert.equal(result.truncated, true);
  const edge = searchLocalResult("ristoranti", { latitude: 45.07, longitude: 7.78 });
  assert.ok(edge.places.length > 0);
  assert.equal(edge.coverage.extent, "partial");
  assert.equal(edge.coverage.centerInside, false);
  const name = searchLocalResult("Amen Bar", docks);
  assert.equal(name.coverage.extent, "package");
  assert.equal(name.coverage.radiusMeters, null);
  assert.equal(name.truncated, false);
});

test("59/60/61 distinct matches report the actual cap and decode only displayed records", () => {
  for (const count of [59, 60, 61]) {
    const entries: PlaceSearchEntry[] = Array.from({ length: count }, (_, i) => ({
      id: `fixture:${i}`, name: `Ristorante di prova ${i}`, coordinate: docks,
      category: 'restaurant', hierarchy: ['food_and_drink', 'restaurant'],
      source: 'Fixture', attributions: ['Fixture · CC0-1.0'],
    }));
    let decoded = 0;
    const catalog: PlaceCatalog = {
      entries, metadata: { release: 'fixture', bounds: [7.6, 45, 7.77, 45.14], count, inputSha256: '0'.repeat(64) },
      materialize(id): CatalogPlace | undefined {
        decoded += 1;
        const place = entries.find((entry) => entry.id === id);
        return place ? { ...place, hierarchy: [...place.hierarchy], attributions: [...place.attributions], provenance: [{ dataset: 'Fixture', license: 'CC0-1.0' }], dataUpdatedAt: '2020-01-01' } : undefined;
      },
    };
    const search = createLocalPlaceSearch(catalog);
    assert.equal(decoded, 0);
    const result = search('ristoranti', docks);
    assert.equal(result.places.length, Math.min(count, 60));
    assert.equal(result.truncated, count > 60);
    assert.equal(result.resultLimit, 60);
    assert.equal(decoded, Math.min(count, 60));
    assert.equal(result.places[0]?.dataUpdatedAt, '2020-01-01');
  }
});

test("duplicate contacts retain contributing provenance and applicable corrections without merging separate branches or tenants", () => {
  const catalog = createPlaceCatalog({
    schemaVersion: 1, release: 'fixture', count: 5, bounds: [7.6, 45, 7.77, 45.14], inputSha256: '0'.repeat(64),
    columns: ['id', 'name', 'latitude', 'longitude', 'categoryRef', 'confidence', 'operatingStatus', 'address', 'website', 'phone', 'sourceRefs'],
    categories: [['restaurant', ['food_and_drink', 'restaurant']]],
    sourceTemplates: [
      { dataset: 'Fixture', license: 'CC0-1.0', update_time: '2020-01-01' },
      { dataset: 'Contact source', license: 'Apache-2.0', update_time: '2021-01-01T00:00:00Z', extra: { branch: 'Original branch' } },
      { dataset: 'Other source', license: 'CDLA-Permissive-2.0', update_time: '2022-02-03T08:09:10' },
    ],
    sources: [[0, 'original', null], [1, 'contact-record', 0.8], [2, 'conflicting-record', 0.5]],
    places: [
      ['a', 'Ristorante Prova', docks.latitude, docks.longitude, 0, 0.9, 'open', null, null, null, [0]],
      ['b', 'RISTORANTE PROVA', docks.latitude, docks.longitude, 0, 0.8, null, null, 'https://contacts.example/', '011123456', [1]],
      ['c', 'Ristorante Prova', docks.latitude + 0.003, docks.longitude, 0, 0.9, 'open', null, null, null, [0]],
      ['d', 'Altro Ristorante', docks.latitude, docks.longitude, 0, 0.9, 'open', null, null, null, [0]],
      ['e', 'Ristorante Prova', docks.latitude, docks.longitude, 0, 0.5, 'temporarily_closed', null, 'https://other.example/', '011999999', [2]],
    ],
    phoneOverrides: {
      schemaVersion: 1, version: 'fixture', sha256: '1'.repeat(64), recordCount: 2,
      records: [
        { id: 'overture:b', field: 'phone', originalValue: '011000000', value: '011123456', url: 'https://contacts.example/', checkedAt: '2026-10-11T00:00:00Z', reason: 'Branch contact confirmed.' },
        { id: 'overture:e', field: 'phone', originalValue: '011888888', value: '011999999', url: 'https://other.example/', checkedAt: '2026-10-11T00:00:00Z', reason: 'Other contact confirmed.' },
      ],
    },
  });
  const search = createLocalPlaceSearch(catalog);
  const result = search('ristoranti', docks);
  assert.deepEqual(result.places.map((place) => place.id), ['overture:a', 'overture:d', 'overture:c']);
  assert.equal(result.places[0]?.phone, '011123456');
  assert.equal(result.places[0]?.website, 'https://contacts.example/');
  assert.equal(result.places[0]?.dataUpdatedAt, '2022-02-03T08:09:10');
  assert.ok(result.places.every((place) => place.operatingStatus === 'open' && place.confidence === 0.9));
  assert.ok(result.places.slice(1).every((place) => place.dataUpdatedAt === '2020-01-01'));
  const first = result.places[0] as CatalogPlace;
  assert.deepEqual(first.provenance, ['overture:a', 'overture:b', 'overture:e'].flatMap((id) => catalog.materialize(id)!.provenance));
  assert.deepEqual(first.fieldCorrections, catalog.materialize('overture:b')!.fieldCorrections);
  assert.deepEqual(first.attributions, ['Fixture · CC0-1.0', 'Contact source · Apache-2.0',
    'Telefono corretto da sito ufficiale · https://contacts.example/ · 2026-10-11', 'Other source · CDLA-Permissive-2.0']);
  first.coordinate.latitude = 0;
  first.hierarchy.push('changed');
  first.attributions.push('changed');
  first.provenance[0]!.record_id = 'changed';
  const next = search('ristoranti', docks).places[0] as CatalogPlace;
  assert.deepEqual(next.coordinate, docks);
  assert.deepEqual(next.hierarchy, ['food_and_drink', 'restaurant']);
  assert.ok(!next.attributions.includes('changed'));
  assert.equal(next.provenance[0]?.record_id, 'original');
});

test('the result cap counts duplicate groups and hydrates contributors only in displayed groups', () => {
  const entries: PlaceSearchEntry[] = Array.from({ length: 61 }, (_, i) => ['a', 'b'].map((copy) => ({
    id: `fixture:${String(i).padStart(2, '0')}:${copy}`, name: `Ristorante ${i}`, coordinate: docks,
    category: 'restaurant', hierarchy: ['food_and_drink', 'restaurant'], source: 'Fixture', attributions: ['Fixture · CC0-1.0'],
  }))).flat();
  const decoded: string[] = [];
  const catalog: PlaceCatalog = {
    entries, metadata: { release: 'fixture', bounds: [7.6, 45, 7.77, 45.14], count: entries.length, inputSha256: '0'.repeat(64) },
    materialize(id) {
      decoded.push(id);
      const place = entries.find((entry) => entry.id === id)!;
      return { ...place, hierarchy: [...place.hierarchy], attributions: [...place.attributions],
        provenance: [{ dataset: 'Fixture', license: 'CC0-1.0', record_id: id }], dataUpdatedAt: '2020-01-01' };
    },
  };
  const search = createLocalPlaceSearch(catalog);
  assert.equal(decoded.length, 0);
  const result = search('ristoranti', docks);
  assert.equal(result.places.length, 60);
  assert.equal(result.truncated, true);
  assert.equal(result.resultLimit, 60);
  assert.deepEqual(decoded, entries.slice(0, 120).map((entry) => entry.id));
  assert.ok(result.places.every((place) => (place as CatalogPlace).provenance.length === 2));
});

test("local-only policy makes no remote requests for names, misses, categories or another search center", async () => {
  const original = global.fetch;
  let requests = 0;
  try {
    global.fetch = async () => { requests += 1; throw new Error("Unexpected remote search"); };
    for (const center of [docks, { latitude: 41.9028, longitude: 12.4964 }]) {
      for (const query of ["Amen", "zxq-no-such-place", "farmacie", "a"]) {
        const result = await searchPlaces(query, { center, policy: "local-only" });
        assert.equal(result.source, "Overture Places locale");
        assert.ok(result.places.every((place) => place.id.startsWith("overture:")));
      }
    }
    assert.equal(requests, 0);
  } finally { global.fetch = original; }
});

test("opting out of online search cannot redisplay a cached Photon result", async () => {
  const original = global.fetch;
  let requests = 0;
  try {
    global.fetch = async () => {
      requests += 1;
      return Response.json({ features: [{ geometry: { coordinates: [7.6832, 45.0937] }, properties: {
        name: "Public cache fixture", osm_type: "N", osm_id: 123456,
      } }] });
    };
    const online = await searchPlaces("public cache fixture", { center: docks, policy: "local-and-online" });
    assert.ok(online.places.some((place) => place.id === "osm:N:123456"));
    assert.equal(online.resultLimit, 40);
    assert.equal(online.truncated, false);
    const local = await searchPlaces("public cache fixture", { center: docks, policy: "local-only" });
    assert.deepEqual(local.places, []);
    assert.equal(local.source, "Overture Places locale");
    assert.equal(requests, 1);
  } finally { global.fetch = original; }
});

test('merging a Photon duplicate retains all local contributors and their contact provenance', async () => {
  const winner = placeCatalog.materialize('overture:1eb26f86-9ea7-4203-9e36-3fd8179f5d1b')!;
  const donor = placeCatalog.materialize('overture:15c8811e-1259-41b7-90f7-b65fc5b01f13')!;
  assert.equal(winner.phone, undefined);
  assert.ok(donor.phone);
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({ features: [{
      geometry: { coordinates: [winner.coordinate.longitude, winner.coordinate.latitude] },
      properties: { name: winner.name, osm_type: 'N', osm_id: 987654321, street: 'Other address' },
    }] });
    const result = await searchPlaces(winner.name, { center: winner.coordinate, policy: 'local-and-online' });
    const place = result.places.find((item) => item.id === winner.id) as CatalogPlace;
    assert.equal(place.phone, donor.phone);
    assert.equal(place.website, winner.website);
    assert.equal(place.address, winner.address);
    assert.deepEqual(place.provenance, [...winner.provenance, ...donor.provenance]);
    assert.ok(place.attributions.includes('© OpenStreetMap contributors · ODbL'));
  } finally { global.fetch = original; }
});

test("aborted searches reject in either policy and a pending remote response cannot replace local state", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const policy of ["local-only", "local-and-online"] as const) {
    await assert.rejects(searchPlaces("Amen", { center: docks, policy, signal: controller.signal }), { name: "AbortError" });
  }
  const original = global.fetch;
  const pending = new AbortController();
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  try {
    global.fetch = async () => { started(); return new Promise<Response>(() => {}); };
    const search = searchPlaces("Amen", { center: docks, signal: pending.signal });
    await didStart;
    pending.abort();
    await assert.rejects(search, { name: "AbortError" });
  } finally { global.fetch = original; }
});
test("common food and shopping categories have useful Italian labels", () => {
  assert.equal(categoryLabel("delicatessen"), "Gastronomia");
  assert.equal(categoryLabel("bakery"), "Panetteria");
  assert.equal(categoryLabel("ice_cream_shop"), "Gelateria");
  assert.equal(categoryLabel("clothing_store"), "Abbigliamento");
});
