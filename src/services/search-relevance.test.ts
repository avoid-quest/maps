import test from "node:test";
import assert from "node:assert/strict";
import { searchLocalPlaces, searchLocalResult, searchPlaces, categoryLabel, createLocalPlaceSearch } from "./search";
import { distanceMeters } from "./geo";
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

const centre = { latitude: 45.0703, longitude: 7.6869 };
const sanSalvario = { latitude: 45.05495, longitude: 7.68015 };
const lingotto = { latitude: 45.02615, longitude: 7.64989 };

test("multi-word queries match words across name, address, category and neighbourhood", () => {
  const viaPo = searchLocalPlaces("farmacia via po", centre);
  assert.ok(viaPo.length >= 4);
  assert.ok(viaPo.slice(0, 4).every((place) => place.category === "pharmacy" && /^Via Po\b/i.test(place.address ?? "")), "pharmacies on Via Po lead");
  assert.equal(viaPo[0]?.name, "Farmacia Po");
  assert.deepEqual(searchLocalPlaces("farmacia in via po", centre).map((place) => place.id), viaPo.map((place) => place.id), "linking words are optional");

  const bars = searchLocalPlaces("bar san salvario", centre);
  assert.ok(bars.length >= 10);
  for (const place of bars.slice(0, 10)) {
    assert.ok(distanceMeters(place.coordinate, sanSalvario) <= 2000 || /san salvario/i.test(place.name), place.name);
  }
  assert.ok(!bars.some((place) => /Barbagusto|Baretti/i.test(`${place.name} ${place.address}`) && !/bar|cafe|coffee|pub/.test(place.category ?? "")),
    "a category word is not a prefix of other names or streets");

  const address = searchLocalPlaces("via nizza 230", centre);
  assert.ok(address.length >= 10);
  assert.ok(address.slice(0, 10).every((place) => /Via Nizza,? 230/i.test(place.address ?? "")), "the numbered address leads");
  assert.ok(!searchLocalPlaces("via nizza 23", centre).slice(0, 10).some((place) => /Via Nizza,? 230/i.test(place.address ?? "")), "house numbers match exactly");
});

test("a neighbourhood alone is offered as an area, not a list of every business in it", () => {
  const area = searchLocalPlaces("San Salvario", centre);
  assert.equal(area[0]?.kind, "area");
  assert.equal(area[0]?.name, "San Salvario");
  assert.equal(area[0]?.attributions[0], "© OpenStreetMap contributors · ODbL");
  assert.ok(area.slice(1).every((place) => /san salvario/i.test(`${place.name} ${place.address}`)));
  assert.equal(searchLocalPlaces("Lingotto", centre)[0]?.kind, "area");
  // Exact business names still lead over the neighbourhood reading of their words.
  assert.equal(searchLocalPlaces("Rough San Salvario", centre)[0]?.name, "Rough San Salvario");
  assert.equal(searchLocalPlaces("Da Mido", centre)[0]?.name, "Da Mido | San Salvario");
});

test("Eataly Lingotto: Photon is asked once with the typed words, then with the name near the neighbourhood", async () => {
  // Public OSM objects returned by Photon on 2026-11-02 for "Eataly" biased to the Lingotto node.
  const features = [
    { geometry: { coordinates: [7.667453, 45.03535] }, properties: { osm_type: "W", osm_id: 96238045, osm_key: "shop", osm_value: "supermarket", type: "house", name: "Eataly", street: "Via Nizza", housenumber: "224", postcode: "10126", city: "Torino" } },
    { geometry: { coordinates: [7.683867, 45.067292] }, properties: { osm_type: "N", osm_id: 1478015126, osm_key: "amenity", osm_value: "restaurant", type: "house", name: "Eataly Lagrange", street: "Via Giuseppe Luigi Lagrange", housenumber: "3", postcode: "10123", city: "Torino" } },
  ];
  assert.equal(searchLocalPlaces("Eataly Lingotto", centre).length, 0, "the local package has no Lingotto branch");
  const original = global.fetch;
  const urls: URL[] = [];
  try {
    global.fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return Response.json({ features: url.searchParams.get("q") === "Eataly" ? features : [] });
    };
    const result = await searchPlaces("Eataly Lingotto", { center: centre, policy: "local-and-online" });
    assert.deepEqual(urls.map((url) => url.searchParams.get("q")), ["Eataly Lingotto", "Eataly"]);
    assert.equal(urls[0]!.searchParams.get("lat"), String(centre.latitude));
    assert.equal(urls[1]!.searchParams.get("lat"), String(lingotto.latitude), "the retry is biased to the public neighbourhood node");
    assert.deepEqual(result.places.map((place) => place.name), ["Eataly"], "answers outside the neighbourhood are dropped");
    assert.equal(result.places[0]?.address, "Via Nizza 224, 10126 Torino");
    assert.equal(result.places[0]?.kind, "place");
    assert.ok(Math.abs(result.places[0]!.distanceMeters! - distanceMeters(centre, result.places[0]!.coordinate)) < 1, "distance from the search centre, not the bias");
    // Cached for five minutes: the same search makes no new request.
    await searchPlaces("Eataly Lingotto", { center: centre, policy: "local-and-online" });
    assert.equal(urls.length, 2);
  } finally { global.fetch = original; }
});

test("category, neighbourhood and stop words alone stay local; online answers are labelled as addresses, streets or areas", async () => {
  const original = global.fetch;
  let requests = 0;
  try {
    global.fetch = async () => {
      requests += 1;
      return Response.json({ features: [
        { geometry: { coordinates: [7.6666, 45.0354] }, properties: { osm_type: "N", osm_id: 1, osm_key: "place", osm_value: "house", type: "house", street: "Via Nizza", housenumber: "230", postcode: "10126", city: "Torino" } },
        { geometry: { coordinates: [7.67, 45.04] }, properties: { osm_type: "W", osm_id: 2, osm_key: "highway", osm_value: "secondary", type: "street", name: "Via Nizza", postcode: "10126", city: "Torino" } },
        { geometry: { coordinates: [7.68, 45.055] }, properties: { osm_type: "N", osm_id: 3, osm_key: "place", osm_value: "suburb", type: "district", name: "San Salvario", city: "Torino" } },
      ] });
    };
    await searchPlaces("bar san salvario", { center: centre, policy: "local-and-online" });
    await searchPlaces("pizzeria a lingotto", { center: centre, policy: "local-and-online" });
    // Stop codes and line names are answered from the bundled GTT catalog.
    for (const query of ["472", "fermata 472", "stop 472", "fermate castello", "M1", "linea 4", "bus 15", "tram 4", "metro M1", "10N"]) await searchPlaces(query, { center: centre, policy: "local-and-online" });
    assert.equal(requests, 0);
    const result = await searchPlaces("via nizza 230 online fixture", { center: centre, policy: "local-and-online" });
    const byId = new Map(result.places.map((place) => [place.id, place]));
    assert.deepEqual([byId.get("osm:N:1")?.kind, byId.get("osm:N:1")?.name, byId.get("osm:N:1")?.address], ["address", "Via Nizza 230", "10126 Torino"]);
    assert.equal(byId.get("osm:W:2")?.kind, "street");
    assert.equal(byId.get("osm:N:3")?.kind, "area");
    assert.equal(requests, 1);
  } finally { global.fetch = original; }
});
