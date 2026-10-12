import React, { useMemo, useRef, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Map, Camera, GeoJSONSource, Layer, type CameraRef } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, Point } from 'geojson';
import type { MapCanvasProps } from './MapCanvas.types';
import { diagnostics } from '../services/diagnostics';

export default function MapCanvas({ center, zoom = 14.5, markers = [], selectedMarkerId, route, coverageBounds, userLocation, followLocation, onPressMarker, onMapPress, onRegionChanged }: MapCanvasProps) {
  const camera = useRef<CameraRef>(null);
  const [mapError, setMapError] = useState(false);
  const [longitude, latitude] = center;
  const coverage = useMemo(() => {
    if (!coverageBounds) return null;
    const [west, south, east, north] = coverageBounds;
    return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }, properties: {} };
  }, [coverageBounds]);
  const data = useMemo<FeatureCollection<Point>>(() => ({ type: 'FeatureCollection', features: markers.map(marker => ({ type: 'Feature', id: marker.id, geometry: { type: 'Point', coordinates: marker.coordinate }, properties: { id: marker.id, kind: marker.kind, selected: marker.id === selectedMarkerId, label: marker.label ?? '' } })) }), [markers, selectedMarkerId]);
  useEffect(() => { if (followLocation !== false) camera.current?.easeTo({ center: [longitude, latitude], zoom, duration: 450 }); }, [longitude, latitude, zoom, followLocation]);
  useEffect(() => {
    if (!route?.coordinates.length || followLocation !== undefined) return;
    const xs = route.coordinates.map(p => p[0]!); const ys = route.coordinates.map(p => p[1]!);
    camera.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { padding: { top: 50, right: 50, bottom: 50, left: 50 }, duration: 500 });
  }, [route, followLocation]);
  return <View style={styles.container}>
    <Map style={styles.container} mapStyle="https://tiles.openfreemap.org/styles/liberty" logo={false} attribution attributionPosition={{ bottom: 8, right: 8 }}
      onPress={event => onMapPress?.(event.nativeEvent.lngLat)}
      onRegionDidChange={event => { if (event.nativeEvent.userInteraction) onRegionChanged?.(event.nativeEvent.center); }}
      onDidFailLoadingMap={() => { setMapError(true); diagnostics.record({ type: 'map', state: 'failed' }); }} onDidFinishLoadingMap={() => { setMapError(false); diagnostics.record({ type: 'map', state: 'loaded' }); }}>
      <Camera ref={camera} initialViewState={{ center, zoom }} />
      {coverage && <GeoJSONSource id="local-coverage" data={coverage}>
        <Layer id="local-coverage-fill" type="fill" paint={{ 'fill-color': '#167469', 'fill-opacity': 0.035 }} />
        <Layer id="local-coverage-line" type="line" paint={{ 'line-color': '#167469', 'line-width': 2, 'line-dasharray': [3, 2] }} />
      </GeoJSONSource>}
      {route && <GeoJSONSource id="journey" data={{ type: 'Feature', geometry: route, properties: {} }}><Layer id="journey-casing" type="line" paint={{ 'line-color': '#ffffff', 'line-width': 9 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} /><Layer id="journey-line" type="line" paint={{ 'line-color': '#185CE5', 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} /></GeoJSONSource>}
      <GeoJSONSource id="places" data={data} onPress={event => { event.stopPropagation(); const id = event.nativeEvent.features[0]?.properties?.id; if (typeof id === 'string') onPressMarker?.(id); }}>
        <Layer id="place-circles" type="circle" paint={{ 'circle-radius': ['case', ['get', 'selected'], 12, 7], 'circle-color': ['case', ['==', ['get', 'kind'], 'stop'], '#B9711B', '#185CE5'], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' }} />
        <Layer id="place-label" type="symbol" filter={['==', ['get', 'selected'], true]} layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 1.6], 'text-anchor': 'top' }} paint={{ 'text-color': '#172330', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }} />
      </GeoJSONSource>
      {userLocation && <GeoJSONSource id="position" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: userLocation }, properties: {} }}><Layer id="position-dot" type="circle" paint={{ 'circle-radius': 8, 'circle-color': '#185CE5', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 4 }} /></GeoJSONSource>}
    </Map>
    {mapError && <Text style={styles.error}>Mappa non disponibile · riprova con una connessione</Text>}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1 }, error: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: '#fff9e8', color: '#725015', padding: 8, borderRadius: 8, fontSize: 12 } });
