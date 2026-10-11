import test from "node:test";
import assert from "node:assert/strict";
import { searchLocalPlaces, searchPlaces, categoryLabel } from "./search";
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
  assert.ok(result.warnings.some((warning) => warning.includes("Docks Dora")));
});
test("common food and shopping categories have useful Italian labels", () => {
  assert.equal(categoryLabel("delicatessen"), "Gastronomia");
  assert.equal(categoryLabel("bakery"), "Panetteria");
  assert.equal(categoryLabel("ice_cream_shop"), "Gelateria");
  assert.equal(categoryLabel("clothing_store"), "Abbigliamento");
});
