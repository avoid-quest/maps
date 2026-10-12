import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as WebMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapCanvasProps } from './MapCanvas.types';
import { createRouteFraming } from './map-presentation';
import { diagnostics } from '../services/diagnostics';

export default function MapCanvas(props: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<WebMap | null>(null);
  const latest = useRef(props); latest.current = props;
  const framing = useRef(createRouteFraming());
  const initialView = useRef({ center: props.center, zoom: props.zoom ?? 14.5 });
  const [longitude, latitude] = props.center;
  const zoom = props.zoom ?? 14.5;
  const followLocation = props.followLocation;
  const cameraRevision = props.cameraRevision;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(new URL('/vendor/maplibre-gl-worker.mjs', window.location.href).href);
    const instance = new maplibregl.Map({ container: container.current, style: 'https://tiles.openfreemap.org/styles/liberty', ...initialView.current, attributionControl: false });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
    instance.on('load', () => {
      // Start the standard attribution control collapsed on phone layouts; its links remain one tap away.
      const attribution = instance.getContainer().querySelector<HTMLDetailsElement>('details.maplibregl-compact');
      if (attribution && instance.getCanvasContainer().offsetWidth <= 640) {
        attribution.open = false;
        attribution.classList.remove('maplibregl-compact-show');
      }
      instance.addSource('local-coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'local-coverage-fill', type: 'fill', source: 'local-coverage', paint: { 'fill-color': '#167469', 'fill-opacity': 0.035 } });
      instance.addLayer({ id: 'local-coverage-line', type: 'line', source: 'local-coverage', paint: { 'line-color': '#167469', 'line-width': 2, 'line-dasharray': [3, 2] } });
      instance.addSource('journey', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'journey-casing', type: 'line', source: 'journey', paint: { 'line-width': 9, 'line-color': '#ffffff' }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      instance.addLayer({ id: 'journey-line', type: 'line', source: 'journey', paint: { 'line-width': 5, 'line-color': '#185CE5' }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      instance.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'place-circles', type: 'circle', source: 'places', paint: { 'circle-radius': ['case', ['get', 'selected'], 12, 7], 'circle-color': ['case', ['==', ['get', 'kind'], 'stop'], '#B9711B', '#185CE5'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      instance.addLayer({ id: 'place-label', type: 'symbol', source: 'places', filter: ['==', ['get', 'selected'], true], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.6], 'text-anchor': 'top' }, paint: { 'text-color': '#172330', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      instance.addSource('position', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'position-dot', type: 'circle', source: 'position', paint: { 'circle-radius': 8, 'circle-color': '#185CE5', 'circle-stroke-color': '#fff', 'circle-stroke-width': 4 } });
      setLoaded(true); setFailed(false); diagnostics.record({ type: 'map', state: 'loaded' });
    });
    instance.on('error', () => { if (!instance.isStyleLoaded()) { setFailed(true); diagnostics.record({ type: 'map', state: 'failed' }); } });
    instance.on('click', event => {
      const features = instance.getLayer('place-circles') ? instance.queryRenderedFeatures([[event.point.x - 22, event.point.y - 22], [event.point.x + 22, event.point.y + 22]], { layers: ['place-circles'] }) : [];
      const id = features[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onPressMarker?.(id);
      else latest.current.onMapPress?.([event.lngLat.lng, event.lngLat.lat]);
    });
    instance.on('moveend', event => { if (event.originalEvent) { framing.current.userMoved(latest.current.routeFitKey); const center = instance.getCenter(); latest.current.onRegionChanged?.([center.lng, center.lat]); } });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => { if (loaded && followLocation !== false) map.current?.easeTo({ center: [longitude, latitude], zoom, padding: latest.current.cameraPadding, duration: 450 }); }, [loaded, longitude, latitude, zoom, followLocation, cameraRevision]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    const bounds = props.coverageBounds;
    const [west, south, east, north] = bounds ?? [0, 0, 0, 0];
    (map.current.getSource('local-coverage') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: bounds ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }, properties: {} }] : [] });
  }, [loaded, props.coverageBounds]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource('places') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: (props.markers ?? []).map(marker => ({ type: 'Feature', id: marker.id, geometry: { type: 'Point', coordinates: marker.coordinate }, properties: { id: marker.id, kind: marker.kind, label: marker.label ?? '', selected: marker.id === props.selectedMarkerId } })) });
    (map.current.getSource('position') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: props.userLocation ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: props.userLocation }, properties: {} }] : [] });
  }, [loaded, props.markers, props.selectedMarkerId, props.userLocation]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    (map.current.getSource('journey') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: props.route ? [{ type: 'Feature', geometry: props.route, properties: {} }] : [] });
  }, [loaded, props.route]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    if (followLocation === undefined && framing.current.claim(props.routeFitKey, !!props.route?.coordinates.length) && props.route) {
      const bounds = new maplibregl.LngLatBounds(); props.route.coordinates.forEach(p => bounds.extend([p[0]!, p[1]!]));
      map.current.fitBounds(bounds, { padding: latest.current.cameraPadding ?? 50, duration: 500 });
    }
  }, [loaded, props.route, props.routeFitKey, followLocation]);
  return <div style={{ flex: 1, minHeight: 160, position: 'relative', '--map-attribution-top': `${props.attributionTop ?? 68}px`, '--map-attribution-left': `${props.attributionLeft ?? 8}px` } as React.CSSProperties}><div ref={container} style={{ position: 'absolute', inset: 0 }} />{failed && <div style={{ position: 'absolute', top: (props.attributionTop ?? 68) + 52, left: 10, background: '#fff9e8', padding: 8, borderRadius: 8 }}>Mappa non disponibile · controlla la connessione</div>}</div>;
}
