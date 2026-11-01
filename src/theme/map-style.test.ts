import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from './contrast';
import { applyPaintOverrides, darkPaintOverrides, mapColorsFor, mapStyleFor, mapStyleJsonFor } from './map-style';
import { palettes } from './palette';

const files = { light: 'openfreemap-liberty.json', dark: 'openfreemap-dark.json' } as const;
const read = (file: string) => readFileSync(new URL(`./map-styles/${file}`, import.meta.url));
const paint = (style: StyleSpecification, id: string, property: string) => {
  const layer = style.layers.find(candidate => candidate.id === id);
  return (layer && 'paint' in layer ? (layer.paint as Record<string, unknown> | undefined)?.[property] : undefined);
};

test('bundled styles are the recorded, unmodified OpenFreeMap documents', () => {
  const notice = readFileSync(new URL('./map-styles/NOTICE.md', import.meta.url), 'utf8');
  for (const file of Object.values(files)) {
    const digest = createHash('sha256').update(read(file)).digest('hex');
    assert.ok(notice.includes(`\`${file}\``) && notice.includes(digest), `${file} hash ${digest} must be recorded in NOTICE.md`);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} map style is valid and uses OpenFreeMap tiles, sprites and glyphs`, () => {
    const style = mapStyleFor(scheme);
    assert.deepEqual(validateStyleMin(style as never), []);
    const vector = style.sources.openmaptiles;
    assert.ok(vector && vector.type === 'vector' && 'url' in vector);
    assert.equal(vector.url, 'https://tiles.openfreemap.org/planet', 'TileJSON supplies the OpenFreeMap/OpenMapTiles/OSM attribution');
    assert.match(String(style.sprite), /^https:\/\/tiles\.openfreemap\.org\/sprites\/ofm_[a-z0-9]+\/ofm$/);
    assert.equal(style.glyphs, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    assert.equal(paint(style, 'background', 'background-color')?.toString().toLowerCase(), mapColorsFor(scheme).background.toLowerCase());
    for (const key of ['center', 'zoom', 'bearing', 'pitch'] as const) assert.equal(style[key], undefined, `${key} would move the camera on a style switch`);
    assert.equal(mapStyleFor(scheme), mapStyleFor(scheme), 'Stable identity avoids reloading the style on re-render');
    assert.equal(mapStyleJsonFor(scheme), mapStyleJsonFor(scheme));
    assert.deepEqual(JSON.parse(mapStyleJsonFor(scheme)), style);
  });
}

test('light keeps Liberty unchanged; dark changes only overridden paint colours', () => {
  assert.deepEqual(mapStyleFor('light'), JSON.parse(read(files.light).toString('utf8')));
  const upstream = JSON.parse(read(files.dark).toString('utf8')) as StyleSpecification;
  const dark = mapStyleFor('dark');
  assert.deepEqual(dark.layers.map(layer => layer.id), upstream.layers.map(layer => layer.id));
  dark.layers.forEach((layer, index) => {
    const { paint: changed, ...rest } = layer as typeof layer & { paint?: Record<string, unknown> };
    const { paint: original, ...originalRest } = upstream.layers[index] as typeof layer & { paint?: Record<string, unknown> };
    assert.deepEqual(rest, originalRest);
    for (const property of Object.keys({ ...original, ...changed })) {
      const expected = darkPaintOverrides[layer.id]?.[property] ?? original?.[property];
      assert.deepEqual(changed?.[property], expected, `${layer.id} ${property}`);
    }
  });
  assert.deepEqual(upstream, JSON.parse(read(files.dark).toString('utf8')), 'Overrides never mutate the bundled source');
});

test('paint overrides fail loudly when a style refresh renames a layer or property', () => {
  const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000' } }] } as StyleSpecification;
  assert.throws(() => applyPaintOverrides(style, { missing: { 'fill-color': '#fff' } }), /lacks layers missing/);
  assert.throws(() => applyPaintOverrides(style, { background: { 'background-opacity': 1 } }), /lacks background-opacity/);
});

test('dark basemap labels and app overlays remain legible', () => {
  const dark = mapStyleFor('dark');
  const background = palettes.dark.map.background;
  const water = String(paint(dark, 'water', 'fill-color'));
  for (const id of ['place_city', 'place_suburb', 'place_village', 'highway_name_other', 'highway_name_motorway']) {
    const ratio = contrastRatio(String(paint(dark, id, 'text-color')), background);
    assert.ok(ratio >= AA_TEXT, `${id} label ${ratio.toFixed(2)}`);
  }
  assert.ok(contrastRatio(String(paint(dark, 'water_name', 'text-color')), water) >= AA_TEXT, 'water labels on water');
  for (const id of ['highway_minor', 'highway_major_casing', 'highway_motorway_casing']) {
    const road = String(paint(dark, id, 'line-color'));
    assert.ok(contrastRatio(road, background) > 1.2, `${id} is distinguishable from land`);
    assert.ok(contrastRatio(palettes.dark.map.routeLine, road) >= AA_NON_TEXT, `route line over ${id}`);
  }
  const lightRoad = '#ffffff';
  assert.ok(contrastRatio(palettes.light.map.routeLine, lightRoad) >= AA_NON_TEXT, 'light route line over white Liberty roads');
});
