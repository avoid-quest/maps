import { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { LineString } from 'geojson';
import type { MapColors } from '../../theme';
import type { ColorScheme } from '../../theme/palette';
import type { ManeuverArrow } from '../navigation/guidance-route';
import { remainingGradient } from '../navigation/guidance-route';

/** Route and turn arrow sit under street names, so labels stay readable over the line. */
const BELOW_LABELS = 'highway-name-path';
/** Generic business dots and labels: hidden while driving or cycling; street names stay. */
const POI_LAYERS: { id: string; type: 'circle' | 'symbol' }[] = [
  { id: 'avoid_poi_dot_r1', type: 'circle' }, { id: 'avoid_poi_dot_r7', type: 'circle' }, { id: 'avoid_poi_dot_r20', type: 'circle' },
  { id: 'poi_r1', type: 'symbol' }, { id: 'poi_r7', type: 'symbol' }, { id: 'poi_r20', type: 'symbol' },
];

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
/**
 * Basemap adjustments during guidance: generic business dots and labels hidden while driving or
 * cycling, one-way chevrons (a hidden brand-basemap layer) shown while driving. The style layers are
 * adopted as children of an empty app source because MapLibre RN re-adds sources, and with them
 * their layers, after every style load (a live theme switch); standalone adopted layers would go stale.
 */
export function BasemapGuidanceAdjustments({ reduceBusinesses, oneWayArrows }: { reduceBusinesses: boolean; oneWayArrows: boolean }) {
  const visibility = reduceBusinesses ? 'none' : 'visible';
  return <GeoJSONSource id="avoid-basemap-adjustments" data={EMPTY}>
    {POI_LAYERS.map(layer => layer.type === 'circle'
      ? <Layer key={layer.id} id={layer.id} type="circle" layout={{ visibility }} />
      : <Layer key={layer.id} id={layer.id} type="symbol" layout={{ visibility }} />)}
    <Layer id="avoid_oneway" type="symbol" layout={{ visibility: oneWayArrows ? 'visible' : 'none' }} />
  </GeoJSONSource>;
}

/**
 * Guidance route: a thin muted full route (the travelled part shows through), the active remaining
 * route with a contrasting casing cut at the snapped progress, and one cased arrow through the next
 * junction. Progress changes only paint, never the source geometry.
 */
export function GuidanceRouteLayers({ route, fraction, arrow, colors, scheme }: {
  route: LineString; fraction: number; arrow: ManeuverArrow | null; colors: MapColors; scheme: ColorScheme;
}) {
  const data = useMemo(() => ({ type: 'Feature' as const, geometry: route, properties: {} }), [route]);
  const arrowData = useMemo(() => arrow ? { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: arrow.shaft }, properties: {} } : null, [arrow]);
  const headData = useMemo(() => arrow ? { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: arrow.head.coordinate }, properties: { bearing: arrow.head.bearing } } : null, [arrow]);
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return <>
    <GeoJSONSource id="guidance-route" data={data} lineMetrics>
      <Layer id="guidance-route-traveled" type="line" beforeId={BELOW_LABELS} layout={round} paint={{ 'line-color': colors.routeTraveled, 'line-width': 4 }} />
      <Layer id="guidance-route-casing" type="line" beforeId={BELOW_LABELS} layout={round} paint={{ 'line-width': 11, 'line-gradient': remainingGradient(colors.routeCasing, fraction) as never }} />
      <Layer id="guidance-route-line" type="line" beforeId={BELOW_LABELS} layout={round} paint={{ 'line-width': 7, 'line-gradient': remainingGradient(colors.routeLine, fraction) as never }} />
    </GeoJSONSource>
    {arrowData && headData ? <>
      <GeoJSONSource id="guidance-arrow" data={arrowData}>
        <Layer id="guidance-arrow-casing" type="line" beforeId={BELOW_LABELS} layout={round} paint={{ 'line-color': colors.routeLine, 'line-width': 10 }} />
        <Layer id="guidance-arrow-shaft" type="line" beforeId={BELOW_LABELS} layout={round} paint={{ 'line-color': colors.routeCasing, 'line-width': 5 }} />
      </GeoJSONSource>
      <GeoJSONSource id="guidance-arrow-head" data={headData}>
        <Layer id="guidance-arrow-head-symbol" type="symbol" beforeId={BELOW_LABELS} layout={{
          'icon-image': `arrowhead-${scheme}`, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 0.8,
        }} />
      </GeoJSONSource>
    </> : null}
  </>;
}
