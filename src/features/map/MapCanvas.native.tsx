import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, Point } from 'geojson';
import { useTheme } from '../../theme';
import { diagnostics } from '../../services/diagnostics';
import type { MapCanvasProps } from './MapCanvas.types';
import { createRouteFraming } from './map-presentation';
import { lineLayout, markerLabelLayout, overlayPaint } from './map-overlay-style';

/**
 * The one native map. An appearance change swaps `mapStyle` and layer paint in place: Map and Camera
 * stay mounted, so the camera, route, markers and position survive a Sistema/Chiaro/Scuro switch.
 */
export default function MapCanvas({ center, zoom = 14.5, cameraRevision, routeFitKey, cameraPadding, attributionTop = 68, attributionLeft = 8, markers = [], selectedMarkerId, route, coverageBounds, userLocation, followLocation, onPressMarker, onMapPress, onRegionChanged }: MapCanvasProps) {
  const theme = useTheme();
  const paint = useMemo(() => overlayPaint(theme.map), [theme.map]);
  const framing = useRef(createRouteFraming());
  const padding = useRef(cameraPadding); padding.current = cameraPadding;
  const camera = useRef<CameraRef>(null);
  const [mapError, setMapError] = useState(false);
  const [longitude, latitude] = center;
  const coverage = useMemo(() => {
    if (!coverageBounds) return null;
    const [west, south, east, north] = coverageBounds;
    return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }, properties: {} };
  }, [coverageBounds]);
  const data = useMemo<FeatureCollection<Point>>(() => ({ type: 'FeatureCollection', features: markers.map(marker => ({ type: 'Feature', id: marker.id, geometry: { type: 'Point', coordinates: marker.coordinate }, properties: { id: marker.id, kind: marker.kind, selected: marker.id === selectedMarkerId, label: marker.label ?? '' } })) }), [markers, selectedMarkerId]);
  // The sheet's height changes the visible map: keep the camera's centre in the visible part.
  const { top = 0, right = 0, bottom = 0, left = 0 } = cameraPadding ?? {};
  useEffect(() => { void camera.current?.setStop({ padding: { top, right, bottom, left }, duration: 250, easing: 'ease' }).catch(() => undefined); }, [top, right, bottom, left]);
  useEffect(() => { if (followLocation !== false) camera.current?.easeTo({ center: [longitude, latitude], zoom, padding: padding.current, duration: 450 }); }, [longitude, latitude, zoom, followLocation, cameraRevision]);
  useEffect(() => {
    if (followLocation !== undefined || !framing.current.claim(routeFitKey, !!route?.coordinates.length) || !route) return;
    const xs = route.coordinates.map(p => p[0]!); const ys = route.coordinates.map(p => p[1]!);
    camera.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { padding: padding.current ?? { top: 50, right: 50, bottom: 50, left: 50 }, duration: 500 });
  }, [route, routeFitKey, followLocation]);
  return <View style={[styles.container, { backgroundColor: theme.map.background }]}>
    <Map style={styles.container} mapStyle={theme.mapStyleJson} logo={false} attribution attributionPosition={{ top: attributionTop, left: attributionLeft }}
      onPress={event => onMapPress?.(event.nativeEvent.lngLat)}
      onRegionDidChange={event => { if (event.nativeEvent.userInteraction) { framing.current.userMoved(routeFitKey); onRegionChanged?.(event.nativeEvent.center, event.nativeEvent.zoom); } }}
      onDidFailLoadingMap={() => { setMapError(true); diagnostics.record({ type: 'map', state: 'failed' }); }} onDidFinishLoadingMap={() => { setMapError(false); diagnostics.record({ type: 'map', state: 'loaded' }); }}>
      <Camera ref={camera} initialViewState={{ center, zoom }} />
      {coverage && <GeoJSONSource id="local-coverage" data={coverage}>
        <Layer id="local-coverage-fill" type="fill" paint={paint.coverageFill} />
        <Layer id="local-coverage-line" type="line" paint={paint.coverageLine} />
      </GeoJSONSource>}
      {route && <GeoJSONSource id="journey" data={{ type: 'Feature', geometry: route, properties: {} }}>
        <Layer id="journey-casing" type="line" paint={paint.routeCasing} layout={lineLayout} />
        <Layer id="journey-line" type="line" paint={paint.routeLine} layout={lineLayout} />
      </GeoJSONSource>}
      <GeoJSONSource id="places" data={data} onPress={event => { event.stopPropagation(); const id = event.nativeEvent.features[0]?.properties?.id; if (typeof id === 'string') onPressMarker?.(id); }}>
        <Layer id="place-circles" type="circle" paint={paint.markers} />
        <Layer id="place-label" type="symbol" filter={['==', ['get', 'selected'], true]} layout={markerLabelLayout} paint={paint.markerLabel} />
      </GeoJSONSource>
      {userLocation && <GeoJSONSource id="position" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: userLocation }, properties: {} }}>
        <Layer id="position-dot" type="circle" paint={paint.position} />
      </GeoJSONSource>}
    </Map>
    {mapError && <Text style={[styles.error, { top: attributionTop + 52, backgroundColor: theme.colors.cautionSubtle, color: theme.colors.textPrimary }]}>Mappa non disponibile · riprova con una connessione</Text>}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1 }, error: { position: 'absolute', alignSelf: 'center', padding: 8, borderRadius: 8, fontSize: 14 } });
