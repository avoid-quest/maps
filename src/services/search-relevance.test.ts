import test from "node:test";
import assert from "node:assert/strict";
import { searchLocalPlaces, searchLocalResult, searchPlaces, categoryLabel } from "./search";
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
  assert.equal(searchLocalPlaces("Amne", docks)[0]?.name, "Amen Bar");
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

test("nonempty category results still disclose partial package coverage and actual truncation", () => {
  const result = searchLocalResult("ristoranti", docks);
  assert.ok(result.places.length > 0);
  assert.equal(result.coverage.extent, "partial");
  assert.equal(result.coverage.centerInside, true);
  assert.equal(result.resultLimit, 60);
  assert.equal(result.truncated, true);
  const edge = searchLocalResult("ristoranti", { latitude: 45.095, longitude: 7.714 });
  assert.ok(edge.places.length > 0);
  assert.equal(edge.coverage.extent, "partial");
  assert.equal(edge.coverage.centerInside, false);
  const name = searchLocalResult("Amen Bar", docks);
  assert.equal(name.coverage.extent, "package");
  assert.equal(name.coverage.radiusMeters, null);
  assert.equal(name.truncated, false);
  // This fixed package has exactly 60 deduplicated pizzeria matches: reaching the cap is not truncation.
  const exactCap = searchLocalResult("pizzerie", docks);
  assert.equal(exactCap.places.length, exactCap.resultLimit);
  assert.equal(exactCap.truncated, false);
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
