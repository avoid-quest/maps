import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Color, createExpression, latest, validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { basemapInks, brandRecipe, type BasemapInk } from './brand-basemap';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from './contrast';
import { mapColorsFor, mapStyleFor, mapStyleJsonFor } from './map-style';
import { transformStyle, type StyleDocument, type StyleLayer } from './map-style-transform';

const libertyFile = 'openfreemap-liberty.json';
const readLiberty = () => readFileSync(new URL(`./map-styles/${libertyFile}`, import.meta.url));
const liberty = () => JSON.parse(readLiberty().toString('utf8')) as StyleDocument;
const schemes = ['light', 'dark'] as const;
const layerOf = (style: StyleSpecification, id: string) => style.layers.find(layer => layer.id === id) as StyleLayer | undefined;
const paint = (style: StyleSpecification, id: string, property: string) => layerOf(style, id)?.paint?.[property];

test('the bundled Liberty document is the recorded, unmodified OpenFreeMap response', () => {
  const notice = readFileSync(new URL('./map-styles/NOTICE.md', import.meta.url), 'utf8');
  const digest = createHash('sha256').update(readLiberty()).digest('hex');
  assert.ok(notice.includes(`\`${libertyFile}\``) && notice.includes(digest), `${libertyFile} hash ${digest} must be recorded in NOTICE.md`);
});

for (const scheme of schemes) {
  test(`avoid-${scheme} is valid and uses OpenFreeMap tiles, sprites and glyphs`, () => {
    const style = mapStyleFor(scheme);
    assert.equal(style.name, `avoid-${scheme}`);
    assert.deepEqual(validateStyleMin(style as never), []);
    const vector = style.sources.openmaptiles;
    assert.ok(vector && vector.type === 'vector' && 'url' in vector);
    assert.equal(vector.url, 'https://tiles.openfreemap.org/planet', 'TileJSON supplies the OpenFreeMap/OpenMapTiles/OSM attribution');
    assert.match(String(style.sprite), /^https:\/\/tiles\.openfreemap\.org\/sprites\/ofm_[a-z0-9]+\/ofm$/);
    assert.equal(style.glyphs, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    assert.equal(String(paint(style, 'background', 'background-color')).toLowerCase(), mapColorsFor(scheme).background.toLowerCase());
    for (const key of ['center', 'zoom', 'bearing', 'pitch'] as const) assert.equal(style[key], undefined, `${key} would move the camera on a style switch`);
    assert.equal(mapStyleFor(scheme), mapStyleFor(scheme), 'Stable identity avoids reloading the style on re-render');
    assert.equal(mapStyleJsonFor(scheme), mapStyleJsonFor(scheme));
    assert.deepEqual(JSON.parse(mapStyleJsonFor(scheme)), style);
  });

  test(`avoid-${scheme} is greyscale and draws no coloured sprite icons or patterns`, () => {
    const style = mapStyleFor(scheme);
    const colours: [string, string][] = [];
    const walk = (value: unknown, where: string) => {
      if (typeof value === 'string') { if (Color.parse(value)) colours.push([where, value]); }
      else if (Array.isArray(value)) value.forEach(item => walk(item, where));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, `${where} ${key}`));
    };
    for (const layer of style.layers as StyleLayer[]) {
      walk(layer.paint, layer.id);
      walk(layer.layout, layer.id);
      for (const property of ['icon-image', 'fill-pattern', 'line-pattern']) {
        assert.ok(!(property in (layer.layout ?? {})) && !(property in (layer.paint ?? {})), `${layer.id} uses sprite ${property}`);
      }
    }
    assert.ok(colours.length > 100);
    for (const [where, value] of colours) {
      const { r, g, b } = Color.parse(value)!;
      const spread = Math.round((Math.max(r, g, b) - Math.min(r, g, b)) * 255);
      // Zinc-tinted neutrals reach 9/255 (#A1A1AA); the park green hint and cool water stay within that.
      assert.ok(spread <= 10, `${where} ${value} has channel spread ${spread}/255`);
    }
  });
}

test('both styles derive from Liberty through the recipe without mutating it', () => {
  const upstream = liberty();
  for (const scheme of schemes) {
    const recipe = brandRecipe(scheme);
    const style = mapStyleFor(scheme);
    const expected = upstream.layers.flatMap(layer => [
      ...recipe.insert.filter(entry => entry.before === layer.id).map(entry => entry.layer.id),
      ...(recipe.remove.includes(layer.id) ? [] : [layer.id]),
    ]);
    assert.deepEqual(style.layers.map(layer => layer.id), expected);
    for (const layer of style.layers as StyleLayer[]) {
      const original = upstream.layers.find(candidate => candidate.id === layer.id);
      if (!original) continue;
      assert.equal(layer.type, original.type);
      assert.equal(layer.source, original.source);
      assert.equal(layer['source-layer'], original['source-layer']);
    }
    assert.deepEqual({ ...style, layers: [], name: undefined }, { ...upstream, layers: [], name: undefined }, 'sources, sprite and glyphs are upstream');
  }
  assert.deepEqual(upstream, liberty(), 'The transform never mutates the bundled source');
});

test('the transform fails loudly when upstream layers or properties change', () => {
  const upstream: StyleDocument = {
    version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
      { id: 'roads', type: 'line', source: 's', filter: ['==', 'a', 1], minzoom: 4, paint: { 'line-color': '#111', 'line-width': 1 }, layout: { 'line-cap': 'round' } },
    ],
  };
  const base = { name: 't', patch: {}, keep: ['background', 'roads'], remove: [], insert: [] };
  assert.equal(transformStyle(upstream, base).layers.length, 2);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['background'] }), /does not cover upstream layers roads/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: [...base.keep, 'renamed'] }), /lacks layers renamed/);
  assert.throws(() => transformStyle(upstream, { ...base, remove: ['roads'] }), /more than once: roads/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['background'], patch: { roads: { paint: { 'line-opacity': 1 } } } }), /roads lacks paint line-opacity/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['background'], patch: { roads: { addPaint: { 'line-color': '#fff' } } } }), /already declares paint line-color/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['background'], patch: { roads: { dropLayout: ['line-join'] } } }), /lacks layout line-join/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['background'], patch: { roads: { maxzoom: null } } }), /lacks maxzoom/);
  assert.throws(() => transformStyle(upstream, { ...base, keep: ['roads'], remove: ['background'], insert: [{ before: 'background', layer: { id: 'x', type: 'background' } }] }), /retained anchors background/);
  assert.throws(() => transformStyle(upstream, { ...base, insert: [{ before: 'roads', layer: { id: 'background', type: 'background' } }] }), /reuse layer ids background/);
  const patched = transformStyle(upstream, { ...base, keep: ['background'], patch: { roads: { filter: filter => ['all', filter, true], minzoom: null, dropLayout: ['line-cap'], addPaint: { 'line-opacity': 0.5 } } } });
  assert.deepEqual(patched.layers[1], { id: 'roads', type: 'line', source: 's', filter: ['all', ['==', 'a', 1], true], paint: { 'line-color': '#111', 'line-width': 1, 'line-opacity': 0.5 } });
});

/** Every road surface a route or label can be drawn over, by recipe token. */
const roadSurfaces = ['path', 'service', 'minor', 'secondary', 'primary', 'motorway', 'tunnel', 'plaza', 'rail', 'transit'] as const;
const groundSurfaces = ['land', 'landLifted', 'park', 'building', 'plaza'] as const;
/** Streets a POI or stop label may overlap; labels on major roads keep their halo. */
const streetSurfaces = ['service', 'minor', 'secondary'] as const;

function expectContrast(ink: BasemapInk, scheme: string, foreground: string, label: string, surfaces: readonly (keyof BasemapInk)[], minimum: number) {
  for (const surface of surfaces) {
    const ratio = contrastRatio(foreground, ink[surface]);
    assert.ok(ratio >= minimum, `${scheme} ${label} on ${surface}: ${ratio.toFixed(2)} < ${minimum}`);
  }
}

for (const scheme of schemes) {
  test(`avoid-${scheme}: labels meet AA on their halos and on the surfaces beneath them`, () => {
    const style = mapStyleFor(scheme);
    const ink = basemapInks[scheme];
    const labels = (style.layers as StyleLayer[]).filter(layer => layer.type === 'symbol');
    for (const layer of labels) {
      const color = String(layer.paint?.['text-color']);
      const halo = String(layer.paint?.['text-halo-color']);
      assert.ok(Number(layer.paint?.['text-halo-width']) >= 1, `${layer.id} has a halo`);
      assert.ok(contrastRatio(color, halo) >= AA_TEXT, `${layer.id} on its halo: ${contrastRatio(color, halo).toFixed(2)}`);
    }
    for (const id of ['waterway_line_label', 'water_name_point_label', 'water_name_line_label']) {
      expectContrast(ink, scheme, String(paint(style, id, 'text-color')), id, ['water'], AA_TEXT);
    }
    for (const token of ['cityLabel', 'placeLabel', 'areaLabel', 'poiLabel', 'poiCategory', 'stopLabel', 'stationLabel'] as const) {
      expectContrast(ink, scheme, ink[token], token, groundSurfaces, AA_TEXT);
    }
    for (const token of ['poiLabel', 'poiCategory', 'stopLabel', 'stationLabel'] as const) {
      expectContrast(ink, scheme, ink[token], token, streetSurfaces, AA_TEXT);
    }
    // Road names are drawn along their own road.
    expectContrast(ink, scheme, ink.roadLabel, 'major road name', ['secondary', 'primary', 'motorway'], AA_TEXT);
    expectContrast(ink, scheme, ink.minorRoadLabel, 'minor road name', ['service', 'minor'], AA_TEXT);
    expectContrast(ink, scheme, ink.pathLabel, 'path name', ['path', 'land', 'park', 'plaza'], AA_TEXT);
  });

  test(`avoid-${scheme}: roads, POIs and app overlays stand out from the basemap`, () => {
    const ink = basemapInks[scheme];
    const overlay = mapColorsFor(scheme);
    // Road hierarchy: each class separates from land, and more important roads separate further.
    const classes = ['minor', 'secondary', 'primary', 'motorway'] as const;
    const steps = classes.map(token => contrastRatio(ink[token], ink.land));
    steps.forEach((ratio, index) => {
      assert.ok(ratio >= 1.2, `${scheme} ${classes[index]} on land: ${ratio.toFixed(2)}`);
      if (index) assert.ok(ratio > steps[index - 1]!, `${scheme} ${classes[index]} is stronger than ${classes[index - 1]}`);
    });
    assert.ok(contrastRatio(ink.path, ink.land) >= 1.5, `${scheme} footpaths are visible`);
    assert.ok(contrastRatio(ink.water, ink.land) >= 1.2, `${scheme} water is visible`);

    expectContrast(ink, scheme, overlay.routeLine, 'route line', [...roadSurfaces, ...groundSurfaces, 'water'], AA_NON_TEXT);
    // The 8 px dot is wider than any rail line (≤ 2 px), so rails never fill the area around it.
    const bands = roadSurfaces.filter(token => token !== 'rail' && token !== 'transit');
    expectContrast(ink, scheme, overlay.userLocation, 'location dot', [...bands, ...groundSurfaces, 'water'], AA_NON_TEXT);
    assert.ok(contrastRatio(overlay.userLocation, overlay.userLocationStroke) >= AA_NON_TEXT, 'location dot on its stroke');
    assert.ok(contrastRatio(overlay.userLocationStroke, overlay.routeLine) >= AA_NON_TEXT, 'location stroke separates the dot from the route');
    for (const key of ['placeMarker', 'stopMarker', 'live', 'caution'] as const) {
      expectContrast(ink, scheme, overlay[key], key, [...groundSurfaces, 'minor', 'secondary'], AA_NON_TEXT);
    }
    for (const token of ['poiDot', 'stopRing', 'stationRing'] as const) {
      expectContrast(ink, scheme, ink[token], token, groundSurfaces, AA_NON_TEXT);
    }
  });
}

test('in-app map-style notices reproduce NOTICE.md and every bundled licence text unchanged', () => {
  const notices = JSON.parse(readFileSync(new URL('./map-styles/notices.json', import.meta.url), 'utf8')) as { id: string; title: string; url: string; text: string }[];
  const licences = readdirSync(new URL('./map-styles/LICENSES/', import.meta.url)).map(file => `LICENSES/${file}`);
  assert.deepEqual(notices.map(notice => notice.id).sort(), ['NOTICE.md', ...licences].sort(), 'every licence file reaches the in-app notices');
  for (const notice of notices) {
    assert.equal(notice.text, readFileSync(new URL(`./map-styles/${notice.id}`, import.meta.url), 'utf8'), `${notice.id} copy is verbatim`);
    assert.match(notice.url, /^https:\/\//);
  }
});

test('the transform needs no structuredClone, which Hermes does not implement', () => {
  const original = globalThis.structuredClone;
  try {
    (globalThis as { structuredClone?: unknown }).structuredClone = undefined;
    for (const scheme of schemes) assert.deepEqual(transformStyle(liberty(), brandRecipe(scheme)), mapStyleFor(scheme));
  } finally {
    globalThis.structuredClone = original;
  }
});

test('POI labels name key amenities by OSM subclass, not by the broader class', () => {
  const style = mapStyleFor('dark');
  const field = createExpression(layerOf(style, 'poi_r1')?.layout?.['text-field'], latest.layout_symbol['text-field'] as never);
  assert.equal(field.result, 'success');
  const text = (properties: Record<string, unknown>) => {
    if (field.result !== 'success') throw new Error('invalid text-field');
    const value = field.value.evaluate({ zoom: 17 }, { type: 'Point', properties } as never) as { sections: { text: string }[] };
    return value.sections.map(section => section.text).join('');
  };
  assert.equal(text({ class: 'pharmacy', subclass: 'pharmacy', name: 'Farmacia Centrale' }), 'Farmacia Centrale\nFarmacia');
  assert.equal(text({ class: 'toilets', subclass: 'toilets' }), 'WC');
  assert.equal(text({ class: 'beer', subclass: 'pub', name: 'Old Wild' }), 'Old Wild\nPub');
  assert.equal(text({ class: 'bar', subclass: 'nightclub', name: 'Club' }), 'Club', 'a nightclub is not labelled Bar');
  assert.equal(text({ class: 'shop', subclass: 'chemist', name: 'Acqua & Sapone' }), 'Acqua & Sapone', 'a drugstore is not labelled Farmacia');
  const visible = createExpression(layerOf(style, 'avoid_poi_dot_r1')?.filter, { type: 'boolean' } as never);
  assert.equal(visible.result, 'success');
  const shown = (properties: Record<string, unknown>) => visible.result === 'success' && visible.value.evaluate({ zoom: 17 }, { type: 'Point', properties } as never);
  assert.equal(shown({ class: 'drinking_water', subclass: 'drinking_water', rank: 1 }), true, 'unnamed fountains stay visible');
  assert.equal(shown({ class: 'waste_basket', subclass: 'waste_basket', rank: 1 }), false, 'unnamed bins stay hidden');
  assert.equal(shown({ class: 'railway', subclass: 'tram_stop', rank: 1, name: 'Castello' }), false, 'stops use the transit rings');
});
