import type { CircleLayerSpecification, FillLayerSpecification, LineLayerSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { MapColors } from '../../theme';

type Paint<T extends { paint?: unknown }> = NonNullable<T['paint']>;
type Layout<T extends { layout?: unknown }> = NonNullable<T['layout']>;
export interface OverlayPaint {
  coverageFill: Paint<FillLayerSpecification>;
  coverageLine: Paint<LineLayerSpecification>;
  routeCasing: Paint<LineLayerSpecification>;
  routeLine: Paint<LineLayerSpecification>;
  markers: Paint<CircleLayerSpecification>;
  markerLabel: Paint<SymbolLayerSpecification>;
  position: Paint<CircleLayerSpecification>;
}

/**
 * Paint for the app-owned map layers, shared by the native and web canvases so both follow the
 * resolved appearance. Selection uses a larger radius and a distinct ring, never hue alone.
 */
export function overlayPaint(map: MapColors): OverlayPaint {
  return {
    coverageFill: { 'fill-color': map.coverage, 'fill-opacity': 0.05 },
    coverageLine: { 'line-color': map.coverage, 'line-width': 2, 'line-dasharray': [3, 2] },
    routeCasing: { 'line-color': map.routeCasing, 'line-width': 9 },
    routeLine: { 'line-color': map.routeLine, 'line-width': 5 },
    markers: {
      'circle-radius': ['case', ['get', 'selected'], 12, 7],
      'circle-color': ['case', ['==', ['get', 'kind'], 'stop'], map.stopMarker, map.placeMarker],
      'circle-stroke-width': ['case', ['get', 'selected'], 4, 3],
      'circle-stroke-color': ['case', ['get', 'selected'], map.selectedMarkerStroke, map.markerStroke],
    },
    markerLabel: { 'text-color': map.labelText, 'text-halo-color': map.labelHalo, 'text-halo-width': 2 },
    position: { 'circle-radius': 8, 'circle-color': map.userLocation, 'circle-stroke-color': map.userLocationStroke, 'circle-stroke-width': 4 },
  };
}

export const lineLayout: Layout<LineLayerSpecification> = { 'line-cap': 'round', 'line-join': 'round' };
export const markerLabelLayout: Layout<SymbolLayerSpecification> = { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.6], 'text-anchor': 'top' };
