#!/usr/bin/env node
/**
 * Builds src/data/localities.json, the small neighbourhood gazetteer used to read area words in
 * search ("Eataly Lingotto", "bar San Salvario"). Input: an Overpass JSON export of OSM place nodes
 * within the place-package rectangle, retrieved with
 *
 *   [out:json][timeout:80];(node["place"~"^(suburb|quarter|neighbourhood)$"](44.98,7.57,45.15,7.78););out body;
 *
 * Usage: node scripts/localities.mjs <overpass.json> [retrievedAt YYYY-MM-DD]
 *
 * Selection: every place=suburb, plus quarter/neighbourhood nodes with multi-word names (single
 * words such as "Rossi" or "Crimea" are too often part of business names). "Centro" is excluded as
 * generic. A parenthetical suffix is dropped and the first node of a repeated name wins. Radii are
 * approximate reading areas around the OSM node, not boundaries.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, retrievedAt = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!input) { console.error('usage: node scripts/localities.mjs <overpass.json> [YYYY-MM-DD]'); process.exit(2); }
const data = JSON.parse(readFileSync(input, 'utf8'));
const RADIUS = { suburb: 2000, quarter: 900, neighbourhood: 900 };
const key = name => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const seen = new Set();
const localities = [];
const order = { suburb: 0, quarter: 1, neighbourhood: 2 };
for (const element of [...data.elements].sort((a, b) => order[a.tags.place] - order[b.tags.place] || a.id - b.id)) {
  const kind = element.tags.place;
  const name = (element.tags.name ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  if (!name || key(name) === 'centro' || seen.has(key(name))) continue;
  if (kind !== 'suburb' && key(name).split(' ').length < 2) continue;
  seen.add(key(name));
  localities.push({ id: `osm:node:${element.id}`, name, kind, latitude: Number(element.lat.toFixed(5)), longitude: Number(element.lon.toFixed(5)), radiusMeters: RADIUS[kind] });
}
localities.sort((a, b) => a.name.localeCompare(b.name, 'it'));
const output = {
  schemaVersion: 1,
  source: 'OpenStreetMap place nodes via Overpass API',
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors · ODbL',
  osmBase: data.osm3s?.timestamp_osm_base ?? null,
  retrievedAt,
  query: '[out:json];(node["place"~"^(suburb|quarter|neighbourhood)$"](44.98,7.57,45.15,7.78););out body;',
  selection: 'place=suburb, plus multi-word quarter/neighbourhood names; "Centro" excluded; radii are approximate.',
  localities,
};
writeFileSync(new URL('../src/data/localities.json', import.meta.url), `${JSON.stringify(output, null, 1)}\n`);
console.log(`${localities.length} localities`);
