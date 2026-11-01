import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import libertySource from './map-styles/openfreemap-liberty.json';
import { brandRecipe } from './brand-basemap';
import { transformStyle, type StyleDocument } from './map-style-transform';
import { palettes, type ColorScheme, type MapColors } from './palette';

/**
 * Both basemaps (`avoid-dark`, `avoid-light`) derive from the OpenFreeMap Liberty document bundled verbatim
 * (see map-styles/NOTICE.md), so a remote style edit cannot change the app's map. `brandRecipe` in
 * `brand-basemap.ts` restyles, removes and adds layers; `transformStyle` throws when upstream layers no
 * longer match the recipe. Tiles, sprites, glyphs and the TileJSON attribution still come from OpenFreeMap.
 */
const upstream = libertySource as unknown as StyleDocument;

const styles: Record<ColorScheme, StyleSpecification> = {
  light: transformStyle(upstream, brandRecipe('light')) as unknown as StyleSpecification,
  dark: transformStyle(upstream, brandRecipe('dark')) as unknown as StyleSpecification,
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

/** Colours for app-owned map layers (route, markers, labels, location, live and caution states, coverage). */
export function mapColorsFor(scheme: ColorScheme): MapColors {
  return palettes[scheme].map;
}
