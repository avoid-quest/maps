/**
 * A strict, declarative transform from a bundled upstream MapLibre style to a derived style.
 *
 * Every upstream layer must be accounted for exactly once: patched, kept unchanged or removed. A style
 * refresh that adds, renames or drops a layer, or that adds or drops a patched property, therefore throws
 * instead of silently leaking upstream colours or icons into the app's basemap.
 */
type Json = Record<string, unknown>;
type Expression = unknown;

export interface StyleLayer {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: Expression;
  layout?: Json;
  paint?: Json;
}

export interface StyleDocument {
  version: number;
  name?: string;
  sources: Json;
  sprite?: unknown;
  glyphs?: string;
  layers: StyleLayer[];
  [key: string]: unknown;
}

export interface LayerPatch {
  /** Replace properties the upstream layer declares. */
  paint?: Json;
  layout?: Json;
  /** Declare properties the upstream layer leaves at their default. */
  addPaint?: Json;
  addLayout?: Json;
  /** Remove declared properties, e.g. sprite icons and patterns. */
  dropPaint?: string[];
  dropLayout?: string[];
  /** Derive a new filter from the upstream one, so upstream semantics stay visible in the recipe. */
  filter?: (upstream: Expression) => Expression;
  /** `null` removes the upstream zoom bound. */
  minzoom?: number | null;
  maxzoom?: number | null;
}

export interface StyleRecipe {
  name: string;
  patch: Record<string, LayerPatch>;
  /** Upstream layers deliberately left unchanged. */
  keep: string[];
  remove: string[];
  /** New layers inserted directly before an upstream layer that the recipe does not remove. */
  insert: { before: string; layer: StyleLayer }[];
}

function replaceDeclared(id: string, kind: string, current: Json, values: Json | undefined): Json {
  const missing = Object.keys(values ?? {}).filter(key => !(key in current));
  if (missing.length) throw new Error(`Map style layer ${id} lacks ${kind} ${missing.join(', ')}`);
  return { ...current, ...values };
}

function addUndeclared(id: string, kind: string, current: Json, values: Json | undefined): Json {
  const declared = Object.keys(values ?? {}).filter(key => key in current);
  if (declared.length) throw new Error(`Map style layer ${id} already declares ${kind} ${declared.join(', ')}`);
  return { ...current, ...values };
}

function drop(id: string, kind: string, current: Json, keys: string[] | undefined): Json {
  const missing = (keys ?? []).filter(key => !(key in current));
  if (missing.length) throw new Error(`Map style layer ${id} lacks ${kind} ${missing.join(', ')}`);
  return Object.fromEntries(Object.entries(current).filter(([key]) => !keys?.includes(key)));
}

function setZoom(layer: StyleLayer, key: 'minzoom' | 'maxzoom', value: number | null | undefined) {
  if (value === undefined) return;
  if (value === null) {
    if (!(key in layer)) throw new Error(`Map style layer ${layer.id} lacks ${key}`);
    delete layer[key];
  } else layer[key] = value;
}

export function applyLayerPatch(layer: StyleLayer, patch: LayerPatch): StyleLayer {
  const next: StyleLayer = { ...layer };
  let paint = layer.paint ?? {};
  paint = drop(layer.id, 'paint', paint, patch.dropPaint);
  paint = replaceDeclared(layer.id, 'paint', paint, patch.paint);
  paint = addUndeclared(layer.id, 'paint', paint, patch.addPaint);
  let layout = layer.layout ?? {};
  layout = drop(layer.id, 'layout', layout, patch.dropLayout);
  layout = replaceDeclared(layer.id, 'layout', layout, patch.layout);
  layout = addUndeclared(layer.id, 'layout', layout, patch.addLayout);
  if (Object.keys(paint).length) next.paint = paint; else delete next.paint;
  if (Object.keys(layout).length) next.layout = layout; else delete next.layout;
  if (patch.filter) {
    if (!('filter' in layer)) throw new Error(`Map style layer ${layer.id} lacks filter`);
    next.filter = patch.filter(layer.filter);
  }
  setZoom(next, 'minzoom', patch.minzoom);
  setZoom(next, 'maxzoom', patch.maxzoom);
  return next;
}

/** Applies a recipe without mutating `upstream`. Throws when the recipe and upstream layers disagree. */
export function transformStyle(upstream: StyleDocument, recipe: StyleRecipe): StyleDocument {
  const upstreamIds = upstream.layers.map(layer => layer.id);
  const claims = [...Object.keys(recipe.patch), ...recipe.keep, ...recipe.remove];
  const duplicate = claims.filter((id, index) => claims.indexOf(id) !== index);
  if (duplicate.length) throw new Error(`Map style recipe claims layers more than once: ${[...new Set(duplicate)].join(', ')}`);
  const unknown = claims.filter(id => !upstreamIds.includes(id));
  if (unknown.length) throw new Error(`Map style lacks layers ${unknown.join(', ')}`);
  const unclaimed = upstreamIds.filter(id => !claims.includes(id));
  if (unclaimed.length) throw new Error(`Map style recipe does not cover upstream layers ${unclaimed.join(', ')}`);

  const inserted = recipe.insert.map(entry => entry.layer.id);
  const clashes = inserted.filter((id, index) => upstreamIds.includes(id) || inserted.indexOf(id) !== index);
  if (clashes.length) throw new Error(`Map style insertions reuse layer ids ${clashes.join(', ')}`);
  const anchors = recipe.insert.map(entry => entry.before).filter(id => !upstreamIds.includes(id) || recipe.remove.includes(id));
  if (anchors.length) throw new Error(`Map style insertions need retained anchors ${anchors.join(', ')}`);

  const layers: StyleLayer[] = [];
  for (const layer of upstream.layers) {
    for (const entry of recipe.insert) if (entry.before === layer.id) layers.push(structuredClone(entry.layer));
    if (recipe.remove.includes(layer.id)) continue;
    const patch = recipe.patch[layer.id];
    layers.push(patch ? applyLayerPatch(structuredClone(layer), patch) : structuredClone(layer));
  }
  return { ...structuredClone(upstream), name: recipe.name, layers };
}
