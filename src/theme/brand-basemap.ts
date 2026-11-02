import type { ColorScheme } from './palette';
import type { LayerPatch, StyleLayer, StyleRecipe } from './map-style-transform';

/**
 * The avoid maps basemap: OpenFreeMap Liberty reduced to greyscale "ink" so app overlays (route, position,
 * selection, live and caution states) are the only emphasis on the map.
 *
 * Hierarchy comes from lightness steps and line width, never hue. The single exception is green space:
 * parks carry a barely perceptible green hint (sRGB channel spread ≤ 6/255) because parks, gardens and
 * riverside paths are walking destinations that pure grey would merge with squares and residential land.
 * POI icons are not SDF in the OpenFreeMap sprite, so they cannot be tinted; POIs become small circle
 * layers with text, and key amenities name their category in words.
 */
export interface BasemapInk {
  land: string;
  /** Residential land at low zoom, schools, hospitals, pitches, sand, ice, airports. */
  landLifted: string;
  park: string;
  parkEdge: string;
  water: string;
  waterLabel: string;
  building: string;
  buildingEdge: string;
  /** Pedestrian squares and areas. */
  plaza: string;
  path: string;
  pathCasing: string;
  service: string;
  serviceCasing: string;
  minor: string;
  minorCasing: string;
  secondary: string;
  secondaryCasing: string;
  primary: string;
  primaryCasing: string;
  motorway: string;
  motorwayCasing: string;
  tunnel: string;
  tunnelCasing: string;
  rail: string;
  /** Tram, light rail and metro. */
  transit: string;
  railTunnel: string;
  boundary: string;
  /** Halo for every label drawn on land or roads. */
  halo: string;
  cityLabel: string;
  placeLabel: string;
  /** Suburbs, quarters and states. */
  areaLabel: string;
  roadLabel: string;
  minorRoadLabel: string;
  pathLabel: string;
  poiLabel: string;
  poiCategory: string;
  poiDot: string;
  stopRing: string;
  stopLabel: string;
  stationRing: string;
  stationLabel: string;
}

export const basemapInks: Record<ColorScheme, BasemapInk> = {
  dark: {
    land: '#0B0B0C',
    landLifted: '#111113',
    park: '#0F1511',
    parkEdge: '#131915',
    water: '#202226',
    waterLabel: '#92959C',
    building: '#141416',
    buildingEdge: '#1A1A1D',
    plaza: '#1A1A1D',
    path: '#3A3A40',
    pathCasing: '#1A1A1D',
    service: '#1D1D20',
    serviceCasing: '#151517',
    minor: '#242428',
    minorCasing: '#18181B',
    secondary: '#2D2D32',
    secondaryCasing: '#1D1D20',
    primary: '#36363C',
    primaryCasing: '#222226',
    motorway: '#3E3E45',
    motorwayCasing: '#27272B',
    tunnel: '#18181B',
    tunnelCasing: '#202024',
    rail: '#4E4E55',
    transit: '#43434A',
    railTunnel: '#2A2A2F',
    boundary: '#3F3F46',
    halo: '#0B0B0C',
    cityLabel: '#E4E4E7',
    placeLabel: '#C4C4CA',
    areaLabel: '#8E8E96',
    roadLabel: '#B4B4BB',
    minorRoadLabel: '#A8A8B0',
    pathLabel: '#A8A8B0',
    poiLabel: '#B4B4BB',
    poiCategory: '#9A9AA2',
    poiDot: '#6B6B73',
    stopRing: '#A1A1A9',
    stopLabel: '#C4C4CA',
    stationRing: '#E4E4E7',
    stationLabel: '#F4F4F5',
  },
  light: {
    land: '#F5F5F4',
    landLifted: '#EDEDEC',
    park: '#E5EBE5',
    parkEdge: '#D6DCD7',
    water: '#D8DADE',
    waterLabel: '#52565C',
    building: '#E9E9E8',
    buildingEdge: '#DCDCDB',
    plaza: '#ECECEB',
    path: '#C6C6CB',
    pathCasing: '#FFFFFF',
    service: '#E7E7E9',
    serviceCasing: '#FFFFFF',
    minor: '#DFDFE2',
    minorCasing: '#FFFFFF',
    secondary: '#D8D8DC',
    secondaryCasing: '#FFFFFF',
    primary: '#CDCDD2',
    primaryCasing: '#FFFFFF',
    motorway: '#BEBEC4',
    motorwayCasing: '#FFFFFF',
    tunnel: '#EBEBEC',
    tunnelCasing: '#DADADC',
    rail: '#9C9CA4',
    transit: '#ABABB2',
    railTunnel: '#CFCFD3',
    boundary: '#A1A1AA',
    halo: '#F5F5F4',
    cityLabel: '#18181B',
    placeLabel: '#27272A',
    areaLabel: '#5F5F67',
    roadLabel: '#45454D',
    minorRoadLabel: '#52525A',
    pathLabel: '#4A4A52',
    poiLabel: '#3F3F46',
    poiCategory: '#55555D',
    poiDot: '#85858D',
    stopRing: '#52525A',
    stopLabel: '#3F3F46',
    stationRing: '#18181B',
    stationLabel: '#09090B',
  },
};

/**
 * Category words for the amenities a pedestrian looks for, keyed by the OpenMapTiles POI `subclass` (the
 * OSM tag value). Shown under the name, or alone when the feature is unnamed (most toilets and drinking
 * fountains), so the category never depends on colour. Matching `subclass` rather than `class` keeps
 * siblings out: `bar/nightclub` is not a bar and `fast_food/food_court` is not a fast-food outlet.
 * `shop/chemist` is deliberately absent: in Italy it is a drugstore, not a pharmacy (`amenity=pharmacy`).
 */
export const poiCategoryLabels: Record<string, string> = {
  restaurant: 'Ristorante',
  fast_food: 'Fast food',
  cafe: 'Caffè',
  bar: 'Bar',
  pub: 'Pub',
  biergarten: 'Pub',
  ice_cream: 'Gelateria',
  bakery: 'Panetteria',
  pharmacy: 'Farmacia',
  toilets: 'WC',
  drinking_water: 'Acqua potabile',
};

/** Local names: Turin's labels read "Torino" and "Duomo di Torino", matching Italian search results. */
const localName = ['get', 'name'];
const poiClass = ['get', 'class'];
const poiSubclass = ['get', 'subclass'];
const category = ['match', poiSubclass, ...Object.entries(poiCategoryLabels).flat(), ''];
const hasCategory = ['match', poiSubclass, Object.keys(poiCategoryLabels), true, false];
const transitStop = ['all', ['match', poiClass, ['bus', 'railway'], true, false], ['match', ['get', 'subclass'], ['bus_stop', 'bus_station', 'tram_stop'], true, false]];
const station = ['all', ['==', poiClass, 'railway'], ['match', ['get', 'subclass'], ['station', 'halt', 'subway'], true, false]];
const transitClass = ['match', poiClass, ['bus', 'railway'], true, false];
/** Generic POIs need a name or a key category; unnamed benches, bins and bollards add only noise. */
const visiblePoi = ['all', ['!', transitClass], ['any', ['has', 'name'], hasCategory]];

const regular = ['Noto Sans Regular'];
const bold = ['Noto Sans Bold'];
const linear = (stops: number[]) => ['interpolate', ['linear'], ['zoom'], ...stops];

const placeIcon = ['icon-allow-overlap', 'icon-image', 'icon-optional', 'icon-size'];
const textOnly = (color: string, halo: string, extra: LayerPatch = {}): LayerPatch => ({
  ...extra,
  paint: { 'text-color': color, 'text-halo-color': halo, ...extra.paint },
});

export function brandRecipe(scheme: ColorScheme): StyleRecipe {
  const ink = basemapInks[scheme];
  const fill = (color: string, more: Record<string, unknown> = {}): LayerPatch => ({ paint: { 'fill-color': color, ...more } });
  const line = (color: string, more: Record<string, unknown> = {}): LayerPatch => ({ paint: { 'line-color': color, ...more } });
  const label = (color: string, haloWidth?: number): LayerPatch => ({
    paint: { 'text-color': color, 'text-halo-color': ink.halo, 'text-halo-blur': 0, ...(haloWidth ? { 'text-halo-width': haloWidth } : {}) },
  });
  const poiLabel: LayerPatch = {
    filter: upstream => ['all', upstream, visiblePoi],
    dropLayout: ['icon-image'],
    layout: {
      'text-field': ['case',
        ['all', ['has', 'name'], hasCategory], ['format', localName, {}, '\n', {}, category, { 'font-scale': 0.85, 'text-color': ink.poiCategory }],
        ['has', 'name'], ['format', localName, {}],
        ['format', category, { 'text-color': ink.poiCategory }]],
      'text-font': regular,
      'text-anchor': 'left',
      'text-offset': [0.7, 0],
      'text-size': 11.5,
    },
    addLayout: { 'text-justify': 'left' },
    paint: { 'text-color': ink.poiLabel, 'text-halo-color': ink.halo, 'text-halo-blur': 0, 'text-halo-width': 1.2 },
  };
  const placeLabel = (color: string): LayerPatch => ({
    dropLayout: placeIcon,
    layout: { 'text-field': localName },
    paint: { 'text-color': color, 'text-halo-color': ink.halo, 'text-halo-blur': 0 },
  });
  const textField = { layout: { 'text-field': localName } };

  const dot = (rank: [number, number?], minzoom: number): StyleLayer => ({
    id: `avoid_poi_dot_r${rank[0]}`,
    type: 'circle',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom,
    filter: ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['>=', ['get', 'rank'], rank[0]], ...(rank[1] ? [['<', ['get', 'rank'], rank[1]]] : []), visiblePoi],
    paint: { 'circle-color': ink.poiDot, 'circle-radius': linear([15, 1.75, 18, 3]) },
  });

  return {
    name: scheme === 'dark' ? 'avoid-dark' : 'avoid-light',
    remove: [
      // Coloured shaded relief at z<7; the app is city-scale and the grey land reads better without it.
      'natural_earth',
      // One-way arrows matter to drivers, not to pedestrians or passengers.
      'road_one_way_arrow', 'road_one_way_arrow_opposite',
      // Extrusions shade buildings into the foreground; flat footprints stay at every zoom instead.
      'building-3d',
      // United States shields never match Italian roads and draw coloured sprite badges.
      'highway-shield-us-interstate', 'road_shield_us',
    ],
    keep: [],
    insert: [
      {
        // Driving guidance shows one-way chevrons (app image `oneway-<scheme>`); hidden otherwise.
        before: 'highway-name-path',
        layer: {
          id: 'avoid_oneway', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 15,
          // `oneway` 1 runs with the line geometry, -1 against it: the chevron turns round.
          filter: ['all', ['match', ['get', 'oneway'], [1, -1], true, false], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false]],
          layout: {
            visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': `oneway-${scheme}`, 'icon-rotate': ['match', ['get', 'oneway'], -1, 270, 90],
            'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          },
        },
      },
      { before: 'poi_r20', layer: dot([1, 7], 15) },
      { before: 'poi_r20', layer: dot([7, 20], 16) },
      { before: 'poi_r20', layer: dot([20], 17) },
      {
        before: 'poi_r20',
        layer: {
          id: 'avoid_transit_stop_ring', type: 'circle', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 14.5, filter: transitStop,
          paint: { 'circle-color': ink.land, 'circle-radius': linear([14.5, 2, 18, 4.5]), 'circle-stroke-color': ink.stopRing, 'circle-stroke-width': linear([14.5, 1, 18, 1.5]) },
        },
      },
      {
        before: 'poi_r20',
        layer: {
          id: 'avoid_station_ring', type: 'circle', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 12, filter: station,
          paint: { 'circle-color': ink.land, 'circle-radius': linear([12, 3, 18, 7]), 'circle-stroke-color': ink.stationRing, 'circle-stroke-width': linear([12, 1.5, 18, 2.5]) },
        },
      },
      {
        // Placed after road names, so stations win label collisions over streets and shops.
        before: 'airport',
        layer: {
          id: 'avoid_station_label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 13, filter: station,
          layout: {
            'text-field': localName, 'text-font': bold, 'text-size': linear([13, 11, 16, 13.5]), 'text-max-width': 9,
            'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto',
          },
          paint: { 'text-color': ink.stationLabel, 'text-halo-color': ink.halo, 'text-halo-width': 1.5 },
        },
      },
    ],
    patch: {
      background: { paint: { 'background-color': ink.land } },
      park: fill(ink.park, { 'fill-opacity': 1, 'fill-outline-color': ink.parkEdge }),
      park_outline: { ...line(ink.parkEdge), dropPaint: ['line-dasharray'] },
      landuse_residential: fill(ink.landLifted),
      landcover_wood: fill(ink.park, { 'fill-opacity': 0.8 }),
      landcover_grass: fill(ink.park, { 'fill-opacity': 0.8 }),
      landcover_ice: fill(ink.landLifted, { 'fill-opacity': 1 }),
      landcover_wetland: { dropPaint: ['fill-pattern'], addPaint: { 'fill-color': ink.park } },
      landuse_pitch: fill(ink.landLifted),
      landuse_track: fill(ink.landLifted),
      landuse_cemetery: fill(ink.landLifted),
      landuse_hospital: fill(ink.landLifted),
      landuse_school: fill(ink.landLifted),
      waterway_tunnel: line(ink.water),
      waterway_river: line(ink.water),
      waterway_other: line(ink.water),
      water: fill(ink.water),
      landcover_sand: fill(ink.landLifted),
      aeroway_fill: fill(ink.landLifted, { 'fill-opacity': 1 }),
      aeroway_runway: line(ink.service),
      aeroway_taxiway: line(ink.service),

      tunnel_motorway_link_casing: line(ink.tunnelCasing),
      tunnel_service_track_casing: line(ink.tunnelCasing),
      tunnel_link_casing: line(ink.tunnelCasing),
      tunnel_street_casing: line(ink.tunnelCasing),
      tunnel_secondary_tertiary_casing: line(ink.tunnelCasing),
      tunnel_trunk_primary_casing: line(ink.tunnelCasing),
      tunnel_motorway_casing: line(ink.tunnelCasing),
      tunnel_path_pedestrian: line(ink.path),
      tunnel_motorway_link: line(ink.tunnel),
      tunnel_service_track: line(ink.tunnel),
      tunnel_link: line(ink.tunnel),
      tunnel_minor: line(ink.tunnel),
      tunnel_secondary_tertiary: line(ink.tunnel),
      tunnel_trunk_primary: line(ink.tunnel),
      tunnel_motorway: line(ink.tunnel),
      tunnel_major_rail: line(ink.railTunnel),
      tunnel_major_rail_hatching: line(ink.railTunnel),
      tunnel_transit_rail: line(ink.railTunnel),
      tunnel_transit_rail_hatching: line(ink.railTunnel),

      road_area_pattern: { dropPaint: ['fill-pattern'], addPaint: { 'fill-color': ink.plaza } },
      road_motorway_link_casing: line(ink.motorwayCasing),
      road_service_track_casing: line(ink.serviceCasing),
      road_link_casing: line(ink.secondaryCasing),
      road_minor_casing: line(ink.minorCasing),
      road_secondary_tertiary_casing: line(ink.secondaryCasing),
      road_trunk_primary_casing: line(ink.primaryCasing),
      road_motorway_casing: line(ink.motorwayCasing),
      road_path_pedestrian: line(ink.path),
      road_motorway_link: line(ink.motorway),
      road_service_track: line(ink.service),
      road_link: line(ink.secondary),
      road_minor: line(ink.minor),
      road_secondary_tertiary: line(ink.secondary),
      road_trunk_primary: line(ink.primary),
      road_motorway: line(ink.motorway),
      road_major_rail: line(ink.rail),
      road_major_rail_hatching: line(ink.rail),
      road_transit_rail: line(ink.transit),
      road_transit_rail_hatching: line(ink.transit),

      bridge_motorway_link_casing: line(ink.motorwayCasing),
      bridge_service_track_casing: line(ink.serviceCasing),
      bridge_link_casing: line(ink.secondaryCasing),
      bridge_street_casing: line(ink.minorCasing),
      bridge_path_pedestrian_casing: line(ink.pathCasing),
      bridge_secondary_tertiary_casing: line(ink.secondaryCasing),
      bridge_trunk_primary_casing: line(ink.primaryCasing),
      bridge_motorway_casing: line(ink.motorwayCasing),
      bridge_path_pedestrian: line(ink.path),
      bridge_motorway_link: line(ink.motorway),
      bridge_service_track: line(ink.service),
      bridge_link: line(ink.secondary),
      bridge_street: line(ink.minor),
      bridge_secondary_tertiary: line(ink.secondary),
      bridge_trunk_primary: line(ink.primary),
      bridge_motorway: line(ink.motorway),
      bridge_major_rail: line(ink.rail),
      bridge_major_rail_hatching: line(ink.rail),
      bridge_transit_rail: line(ink.transit),
      bridge_transit_rail_hatching: line(ink.transit),

      // Upstream hands footprints over to `building-3d` at z14; flat footprints continue instead.
      building: { ...fill(ink.building, { 'fill-outline-color': ink.buildingEdge }), maxzoom: null },
      boundary_3: line(ink.boundary),
      boundary_2: line(ink.boundary),
      boundary_disputed: line(ink.boundary),

      waterway_line_label: { ...textField, ...textOnly(ink.waterLabel, ink.water) },
      water_name_point_label: { ...textField, ...textOnly(ink.waterLabel, ink.water) },
      water_name_line_label: { ...textField, ...textOnly(ink.waterLabel, ink.water) },
      poi_r20: poiLabel,
      poi_r7: poiLabel,
      poi_r1: poiLabel,
      // Upstream matches classes `airport`, `bus` and `rail`; OpenMapTiles files tram stops under `railway`.
      poi_transit: {
        filter: () => transitStop,
        minzoom: 16,
        dropLayout: ['icon-image', 'icon-size'],
        layout: { 'text-field': localName, 'text-font': regular, 'text-offset': [0.8, 0], 'text-size': 11.5 },
        ...label(ink.stopLabel, 1.2),
      },
      'highway-name-path': { ...textField, paint: { 'text-color': ink.pathLabel, 'text-halo-color': ink.halo, 'text-halo-width': 1 } },
      'highway-name-minor': { ...textField, paint: { 'text-color': ink.minorRoadLabel, 'text-halo-blur': 0, 'text-halo-width': 1.2 }, addPaint: { 'text-halo-color': ink.halo } },
      'highway-name-major': { ...textField, paint: { 'text-color': ink.roadLabel, 'text-halo-blur': 0, 'text-halo-width': 1.2 }, addPaint: { 'text-halo-color': ink.halo } },
      // Road numbers stay as plain text: the shield sprites are coloured badges.
      'highway-shield-non-us': {
        // Upstream also prints railway track and platform numbers; keep only road numbers.
        filter: upstream => ['all', upstream, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false]],
        dropLayout: ['icon-image', 'icon-rotation-alignment', 'icon-size'],
        addPaint: { 'text-color': ink.areaLabel, 'text-halo-color': ink.halo, 'text-halo-width': 1.2 },
      },
      airport: { dropLayout: ['icon-image', 'icon-size'], ...textField, ...label(ink.placeLabel) },
      label_other: { layout: { 'text-field': localName, 'text-font': regular }, ...label(ink.areaLabel) },
      label_village: placeLabel(ink.placeLabel),
      label_town: placeLabel(ink.placeLabel),
      label_state: { layout: { 'text-field': localName, 'text-font': regular }, ...label(ink.areaLabel) },
      label_city: placeLabel(ink.cityLabel),
      label_city_capital: placeLabel(ink.cityLabel),
      label_country_3: { ...textField, ...label(ink.placeLabel) },
      label_country_2: { ...textField, ...label(ink.placeLabel) },
      label_country_1: { ...textField, ...label(ink.placeLabel) },
    },
  };
}
