import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LayerSpecification, Map as WebMap, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme, type MapColors } from '../../theme';
import { diagnostics } from '../../services/diagnostics';
import type { MapCanvasProps } from './MapCanvas.types';
import { createRouteFraming } from './map-presentation';
import { lineLayout, markerLabelLayout, overlayPaint } from './map-overlay-style';

const APP_SOURCES = ['local-coverage', 'journey', 'places', 'position'] as const;
const empty = (): SourceSpecification => ({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

/** App layers drawn above the basemap, rebuilt with the current appearance's colours. */
function appLayers(colors: MapColors): LayerSpecification[] {
  const paint = overlayPaint(colors);
  return [
    { id: 'local-coverage-fill', type: 'fill', source: 'local-coverage', paint: paint.coverageFill },
    { id: 'local-coverage-line', type: 'line', source: 'local-coverage', paint: paint.coverageLine },
    { id: 'journey-casing', type: 'line', source: 'journey', paint: paint.routeCasing, layout: lineLayout },
    { id: 'journey-line', type: 'line', source: 'journey', paint: paint.routeLine, layout: lineLayout },
    { id: 'place-circles', type: 'circle', source: 'places', paint: paint.markers },
    { id: 'place-label', type: 'symbol', source: 'places', filter: ['==', ['get', 'selected'], true], layout: markerLabelLayout, paint: paint.markerLabel },
    { id: 'position-dot', type: 'circle', source: 'position', paint: paint.position },
  ];
}

/** A basemap with the app's sources (keeping their current data) and freshly coloured app layers. */
function withAppLayers(base: StyleSpecification, colors: MapColors, previous?: StyleSpecification): StyleSpecification {
  const sources = { ...base.sources };
  for (const id of APP_SOURCES) sources[id] = previous?.sources[id] ?? empty();
  return { ...base, sources, layers: [...base.layers.filter(layer => !APP_SOURCES.some(id => 'source' in layer && layer.source === id)), ...appLayers(colors)] };
}

export default function MapCanvas(props: MapCanvasProps) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<WebMap | null>(null);
  const latest = useRef(props); latest.current = props;
  const themeRef = useRef(theme); themeRef.current = theme;
  const framing = useRef(createRouteFraming());
  const initialView = useRef({ center: props.center, zoom: props.zoom ?? 14.5 });
  const appliedScheme = useRef(theme.scheme);
  const [longitude, latitude] = props.center;
  const zoom = props.zoom ?? 14.5;
  const followLocation = props.followLocation;
  const cameraRevision = props.cameraRevision;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const syncData = useCallback(() => {
    const instance = map.current;
    if (!instance) return;
    const { coverageBounds: bounds, markers = [], selectedMarkerId, userLocation, route } = latest.current;
    const [west, south, east, north] = bounds ?? [0, 0, 0, 0];
    (instance.getSource('local-coverage') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: bounds ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }, properties: {} }] : [] });
    (instance.getSource('places') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: markers.map(marker => ({ type: 'Feature', id: marker.id, geometry: { type: 'Point', coordinates: marker.coordinate }, properties: { id: marker.id, kind: marker.kind, label: marker.label ?? '', selected: marker.id === selectedMarkerId } })) });
    (instance.getSource('position') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: userLocation ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: userLocation }, properties: {} }] : [] });
    (instance.getSource('journey') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: route ? [{ type: 'Feature', geometry: route, properties: {} }] : [] });
  }, []);

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(new URL('/vendor/maplibre-gl-worker.mjs', window.location.href).href);
    const { mapStyle, map: colors } = themeRef.current;
    const instance = new maplibregl.Map({ container: container.current, style: withAppLayers(mapStyle as unknown as StyleSpecification, colors), ...initialView.current, attributionControl: false });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
    instance.on('load', () => {
      // Start the standard attribution control collapsed on phone layouts; its links remain one tap away.
      const attribution = instance.getContainer().querySelector<HTMLDetailsElement>('details.maplibregl-compact');
      if (attribution && instance.getCanvasContainer().offsetWidth <= 640) {
        attribution.open = false;
        attribution.classList.remove('maplibregl-compact-show');
      }
      setLoaded(true); setFailed(false); diagnostics.record({ type: 'map', state: 'loaded' });
    });
    // A style swap keeps sources; push the latest data in case it changed during the swap.
    instance.on('style.load', syncData);
    instance.on('error', () => { if (!instance.isStyleLoaded()) { setFailed(true); diagnostics.record({ type: 'map', state: 'failed' }); } });
    instance.on('click', event => {
      const features = instance.getLayer('place-circles') ? instance.queryRenderedFeatures([[event.point.x - 22, event.point.y - 22], [event.point.x + 22, event.point.y + 22]], { layers: ['place-circles'] }) : [];
      const id = features[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onPressMarker?.(id);
      else latest.current.onMapPress?.([event.lngLat.lng, event.lngLat.lat]);
    });
    instance.on('moveend', event => { if (event.originalEvent) { framing.current.userMoved(latest.current.routeFitKey); const center = instance.getCenter(); latest.current.onRegionChanged?.([center.lng, center.lat], instance.getZoom()); } });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, [syncData]);
  // Appearance switch: same map instance and camera; the basemap changes and app layers are recoloured.
  useEffect(() => {
    const instance = map.current;
    if (!instance || appliedScheme.current === theme.scheme) return;
    appliedScheme.current = theme.scheme;
    instance.setStyle(theme.mapStyle as unknown as StyleSpecification, { transformStyle: (previous, next) => withAppLayers(next, theme.map, previous) });
  }, [theme.scheme, theme.mapStyle, theme.map]);
  useEffect(() => { if (loaded && followLocation !== false) map.current?.easeTo({ center: [longitude, latitude], zoom, padding: latest.current.cameraPadding, duration: 450 }); }, [loaded, longitude, latitude, zoom, followLocation, cameraRevision]);
  useEffect(() => { if (loaded) syncData(); }, [loaded, syncData, props.coverageBounds, props.markers, props.selectedMarkerId, props.userLocation, props.route]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    if (followLocation === undefined && framing.current.claim(props.routeFitKey, !!props.route?.coordinates.length) && props.route) {
      const bounds = new maplibregl.LngLatBounds(); props.route.coordinates.forEach(p => bounds.extend([p[0]!, p[1]!]));
      map.current.fitBounds(bounds, { padding: latest.current.cameraPadding ?? 50, duration: 500 });
    }
  }, [loaded, props.route, props.routeFitKey, followLocation]);
  return <div data-scheme={theme.scheme} style={{ flex: 1, minHeight: 160, position: 'relative', background: theme.map.background, '--map-attribution-top': `${props.attributionTop ?? 68}px`, '--map-attribution-left': `${props.attributionLeft ?? 8}px` } as React.CSSProperties}>
    <div ref={container} style={{ position: 'absolute', inset: 0 }} />
    {failed && <div role="status" style={{ position: 'absolute', top: (props.attributionTop ?? 68) + 52, left: 10, background: theme.colors.cautionSubtle, color: theme.colors.textPrimary, padding: 8, borderRadius: 8 }}>Mappa non disponibile · controlla la connessione</div>}
  </div>;
}
