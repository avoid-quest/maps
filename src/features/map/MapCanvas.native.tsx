import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';
import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, Point } from 'geojson';
import { useTheme } from '../../theme';
import { diagnostics } from '../../services/diagnostics';
import type { MapCanvasProps } from './MapCanvas.types';
import { createOnceFraming, createRouteFraming, frameCamera } from './map-presentation';
import { lineLayout, markerLabelLayout, overlayPaint } from './map-overlay-style';

/**
 * The one native map. An appearance change swaps `mapStyle` and layer paint in place: Map and Camera
 * stay mounted, so the camera, route, markers and position survive a Sistema/Chiaro/Scuro switch.
 */
export default function MapCanvas({ center, zoom = 14.5, cameraRevision, routeFitKey, resultFrame, cameraPadding, attributionTop = 68, attributionLeft = 8, markers = [], selectedMarkerId, route, coverageBounds, userLocation, followLocation, onPressMarker, onMapPress, onRegionChanged, onViewChanged }: MapCanvasProps) {
  const theme = useTheme();
  const paint = useMemo(() => overlayPaint(theme.map), [theme.map]);
  const framing = useRef(createRouteFraming());
  const resultFraming = useRef(createOnceFraming());
  const map = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  /** Counts commanded camera moves, so an asynchronous re-centre never overrides a newer move. */
  const commands = useRef(0);
  const padding = useRef(cameraPadding); padding.current = cameraPadding;
  const camera = useRef<CameraRef>(null);
  const size = useRef({ width: 412, height: 800 });
  const [mapError, setMapError] = useState(false);
  const [longitude, latitude] = center;
  const coverage = useMemo(() => {
    if (!coverageBounds) return null;
    const [west, south, east, north] = coverageBounds;
    return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }, properties: {} };
  }, [coverageBounds]);
  const data = useMemo<FeatureCollection<Point>>(() => ({ type: 'FeatureCollection', features: markers.map(marker => ({ type: 'Feature', id: marker.id, geometry: { type: 'Point', coordinates: marker.coordinate }, properties: { id: marker.id, kind: marker.kind, selected: marker.id === selectedMarkerId, label: marker.label ?? '' } })) }), [markers, selectedMarkerId]);
  // The sheet's height changes the visible map. MapLibre RN applies padding only together with a
  // centre or bounds, so re-centre on the camera's actual centre: the point the user was looking at
  // (including after a pan) moves into the newly visible area instead of under the sheet.
  const { top = 0, right = 0, bottom = 0, left = 0 } = cameraPadding ?? {};
  useEffect(() => {
    if (!loaded || followLocation === true) return;
    let current = true;
    const issued = commands.current;
    void map.current?.getCenter().then(center => {
      if (current && issued === commands.current) camera.current?.easeTo({ center, padding: { top, right, bottom, left }, duration: 250 });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [loaded, top, right, bottom, left, followLocation]);
  // A submitted search frames its results once; a pan before the results settle consumes the frame.
  const frameKey = resultFrame?.key;
  const frameBounds = resultFrame?.ready ? resultFrame.bounds : null;
  useEffect(() => {
    if (!loaded || !resultFraming.current.claim(frameKey, !!frameBounds) || !frameBounds) return;
    commands.current += 1;
    // fitBounds has no zoom cap here, and padding taller than the map zoomed to the maximum (a blank
    // building interior for two results 30 m apart): ease to a computed, capped camera instead.
    const inset = padding.current ?? { top: 50, right: 50, bottom: 50, left: 50 };
    camera.current?.easeTo({ ...frameCamera(frameBounds, size.current, inset), padding: inset, duration: 500 });
  }, [loaded, frameKey, frameBounds]);
  useEffect(() => { if (followLocation !== false) { commands.current += 1; camera.current?.easeTo({ center: [longitude, latitude], zoom, padding: padding.current, duration: 450 }); } }, [longitude, latitude, zoom, followLocation, cameraRevision]);
  useEffect(() => {
    if (followLocation !== undefined || !framing.current.claim(routeFitKey, !!route?.coordinates.length) || !route) return;
    const xs = route.coordinates.map(p => p[0]!); const ys = route.coordinates.map(p => p[1]!);
    commands.current += 1;
    camera.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { padding: padding.current ?? { top: 50, right: 50, bottom: 50, left: 50 }, duration: 500 });
  }, [route, routeFitKey, followLocation]);
  return <View style={[styles.container, { backgroundColor: theme.map.background }]} onLayout={event => { size.current = event.nativeEvent.layout; }}>
    <Map ref={map} style={styles.container} mapStyle={theme.mapStyleJson} logo={false} attribution attributionPosition={{ top: attributionTop, left: attributionLeft }}
      onPress={event => onMapPress?.(event.nativeEvent.lngLat)}
      // A user gesture outranks a pending padding re-centre (see `commands`).
      onRegionWillChange={event => { if (event.nativeEvent.userInteraction) commands.current += 1; }}
      onRegionDidChange={event => {
        const { center: shown, zoom: shownZoom, userInteraction } = event.nativeEvent;
        onViewChanged?.(shown, shownZoom);
        if (userInteraction) { commands.current += 1; framing.current.userMoved(routeFitKey); resultFraming.current.userMoved(frameKey); onRegionChanged?.(shown, shownZoom); }
      }}
      onDidFailLoadingMap={() => { setMapError(true); diagnostics.record({ type: 'map', state: 'failed' }); }} onDidFinishLoadingMap={() => { setLoaded(true); setMapError(false); diagnostics.record({ type: 'map', state: 'loaded' }); }}>
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
