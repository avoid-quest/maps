import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import libertySource from './map-styles/openfreemap-liberty.json';
import darkSource from './map-styles/openfreemap-dark.json';
import { palettes, type ColorScheme, type MapColors } from './palette';

/**
 * Basemaps are OpenFreeMap style documents bundled verbatim (see map-styles/NOTICE.md), so a remote
 * style edit cannot change the app's map. Tiles, sprites, glyphs and the TileJSON attribution are still
 * served by OpenFreeMap. Light uses Liberty unchanged; dark uses OpenFreeMap Dark (Dark Matter) with the
 * documented paint overrides below, which lift the near-black base and make labels legible.
 */
type PaintOverrides = Record<string, Record<string, unknown>>;

const darkBackground = palettes.dark.map.background;
const darkWater = '#1D2633';
const darkLabelHalo = '#121417';

/** Every key must exist in the upstream document; map-style.test.ts fails when a refresh renames one. */
export const darkPaintOverrides: PaintOverrides = {
  background: { 'background-color': darkBackground },
  water: { 'fill-color': darkWater },
  landcover_ice_shelf: { 'fill-color': '#22252A' },
  landcover_glacier: { 'fill-color': '#22252A' },
  landuse_residential: { 'fill-color': '#202226' },
  landcover_wood: { 'fill-color': '#1C2620' },
  landuse_park: { 'fill-color': '#1C2620' },
  waterway: { 'line-color': darkWater },
  water_name: { 'text-color': '#8D9BB0', 'text-halo-color': darkLabelHalo },
  building: { 'fill-color': '#25282D', 'fill-outline-color': '#30343A' },
  'aeroway-taxiway': { 'line-color': '#2E3238' },
  'aeroway-runway-casing': { 'line-color': '#3A3F46' },
  'aeroway-area': { 'fill-color': '#23262B' },
  'aeroway-runway': { 'line-color': '#2E3238' },
  road_area_pier: { 'fill-color': darkBackground },
  road_pier: { 'line-color': darkBackground },
  highway_path: { 'line-color': '#3A3F46' },
  highway_minor: { 'line-color': '#30343B' },
  highway_major_casing: { 'line-color': '#474D56' },
  highway_major_inner: { 'line-color': '#393E46' },
  highway_major_subtle: { 'line-color': '#393E46' },
  highway_motorway_casing: { 'line-color': '#525963' },
  highway_motorway_inner: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, 'hsla(0,0%,85%,0.53)', 6, '#434952'] },
  highway_motorway_subtle: { 'line-color': '#30343B' },
  railway_transit: { 'line-color': '#3C4047' },
  railway_transit_dashline: { 'line-color': darkBackground },
  railway_minor: { 'line-color': '#3C4047' },
  railway_minor_dashline: { 'line-color': darkBackground },
  railway: { 'line-color': '#3C4047' },
  railway_dashline: { 'line-color': darkBackground },
  highway_name_other: { 'text-color': '#AEB4BD', 'text-halo-color': darkLabelHalo },
  highway_name_motorway: { 'text-color': '#BCC1C9' },
  boundary_state: { 'line-color': '#4A4F57' },
  'boundary_country_z0-4': { 'line-color': '#555B64' },
  'boundary_country_z5-': { 'line-color': '#555B64' },
  ...Object.fromEntries(['place_other', 'place_suburb', 'place_village', 'place_town', 'place_city', 'place_city_large', 'place_state', 'place_country_other', 'place_country_minor', 'place_country_major']
    .map(id => [id, { 'text-color': '#C3C8CF', 'text-halo-color': darkLabelHalo }])),
};

export function applyPaintOverrides(style: StyleSpecification, overrides: PaintOverrides): StyleSpecification {
  const pending = new Set(Object.keys(overrides));
  const layers = style.layers.map(layer => {
    const paint = overrides[layer.id];
    if (!paint) return layer;
    pending.delete(layer.id);
    const current: Record<string, unknown> = 'paint' in layer && layer.paint ? layer.paint : {};
    const missing = Object.keys(paint).filter(property => !(property in current));
    if (missing.length) throw new Error(`Map style layer ${layer.id} lacks ${missing.join(', ')}`);
    return { ...layer, paint: { ...current, ...paint } } as typeof layer;
  });
  if (pending.size) throw new Error(`Map style lacks layers ${[...pending].join(', ')}`);
  return { ...style, layers };
}

const styles: Record<ColorScheme, StyleSpecification> = {
  light: libertySource as unknown as StyleSpecification,
  dark: applyPaintOverrides(darkSource as unknown as StyleSpecification, darkPaintOverrides),
};
const serialized: Partial<Record<ColorScheme, string>> = {};

/** The basemap for a resolved appearance. The object is stable per scheme; do not mutate it. */
export function mapStyleFor(scheme: ColorScheme): StyleSpecification {
  return styles[scheme];
}

/**
 * The same basemap as a JSON string, serialized once per scheme. MapLibre React Native accepts a JSON
 * string and otherwise re-serializes an object style on every Map render.
 */
export function mapStyleJsonFor(scheme: ColorScheme): string {
  return (serialized[scheme] ??= JSON.stringify(styles[scheme]));
}

/** Colours for app-owned map layers (route, markers, labels, location, coverage). */
export function mapColorsFor(scheme: ColorScheme): MapColors {
  return palettes[scheme].map;
}
