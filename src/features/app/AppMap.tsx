import type { LineString } from "geojson";
import { useMemo } from "react";
import { View } from "react-native";
import { toCoordinate, toMapCoordinate } from "../map/coordinates";
import MapCanvas from "../map/MapCanvas";
import { placeMarker, stopMarker, taskMarkers } from "../map/map-layers";
import { resultFrameBounds } from "../map/map-presentation";
import { searchMapStops } from "../search/search-rows";
import { useMapContext } from "../map/useMapModel";
import { useNavigationContext } from "../navigation/useNavigation";
import { usePlacesContext } from "../places/usePlaces";
import { usePlannerContext } from "../planner/usePlanner";
import { useSearchContext } from "../search/useSearch";
import { useTransitContext } from "../transit/useTransit";
import { boardStop, journeyStop, rootTab, selectedPlace, selectedStop } from "./task-model";
import { useTaskState } from "./useTaskModel";
import { useTheme } from "../../theme";

/** The one mounted map: task pins, planning or guidance route, and camera intent. */
export function AppMap({ height, padding, attributionLeft, attributionTop }: {
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  attributionLeft: number;
  attributionTop: number;
}) {
  const theme = useTheme();
  const tasks = useTaskState();
  const { camera, location, userPanned } = useMapContext();
  const navigation = useNavigationContext();
  const search = useSearchContext();
  const places = usePlacesContext();
  const transit = useTransitContext();
  const planner = usePlannerContext();
  const tab = rootTab(tasks);
  const selected = selectedPlace(tasks);
  const board = boardStop(tasks);
  const picking = planner.task?.originStep === "picking";
  const searchPlaces = search.result.places;
  const shownPlaces = useMemo(() => tab === "saved" ? places.saved : search.hasSearch ? searchPlaces : [], [tab, places.saved, search.hasSearch, searchPlaces]);
  const nearbyStops = transit.nearbyStops;
  // A typed stop code or line leads the results; its stops are pinned and framed.
  const searchStops = useMemo(() => tab === "explore" && search.hasSearch
    ? searchMapStops(search.transit, searchPlaces.length) : { pinned: [], framed: [] }, [tab, search.hasSearch, search.transit, searchPlaces.length]);
  const leadStops = searchStops.pinned;
  const markers = useMemo(() => taskMarkers(
    tab === "transit" ? nearbyStops.map(stopMarker) : [...leadStops.map(stopMarker), ...shownPlaces.map(placeMarker)], selected, board,
  ), [tab, nearbyStops, leadStops, shownPlaces, selected, board]);
  // Submitted searches and category choices frame their settled results once (see MapCanvas).
  const frame = search.frame;
  const resultFrame = useMemo(() => {
    if (tab !== "explore" || !search.hasSearch || !frame) return undefined;
    const coordinates = searchStops.framed.length ? searchStops.framed.map(stop => stop.coordinate) : searchPlaces.map(place => place.coordinate);
    const ready = frame.settled && !selected && !board && coordinates.length > 0;
    return { key: frame.key, ready, bounds: ready ? resultFrameBounds(coordinates, camera.searchCenter) : null };
  }, [tab, search.hasSearch, frame, selected, board, searchPlaces, searchStops, camera.searchCenter]);
  const route = planner.routes.route;
  const routeGeometry = useMemo<LineString | null>(
    () => route && route.geometry.length > 1 ? { type: "LineString", coordinates: route.geometry.map(toMapCoordinate) } : null,
    [route],
  );
  const navGeometry = navigation.snapshot.route?.geometry;
  const navRoute = useMemo<LineString | null>(() => navGeometry && navGeometry.length > 1
    ? { type: "LineString", coordinates: navGeometry.map(toMapCoordinate) } : null, [navGeometry]);
  const navCenter = navigation.snapshot.location ?? navigation.snapshot.destination ?? camera.center;
  const navigating = navigation.visible;
  return (
    <View testID="map-viewport" style={{ position: "absolute", top: 0, left: 0, right: 0, height, backgroundColor: theme.map.background }}>
      <MapCanvas
        center={toMapCoordinate(navigating ? navCenter : camera.center)}
        markers={navigating ? [] : markers}
        selectedMarkerId={journeyStop(tasks)?.id ?? selected?.id ?? selectedStop(tasks)?.id}
        userLocation={navigating ? navigation.snapshot.location ? toMapCoordinate(navigation.snapshot.location) : null : location.coordinate ? toMapCoordinate(location.coordinate) : null}
        route={navigating ? navRoute : routeGeometry}
        routeFitKey={navigating ? undefined : planner.fitKey}
        resultFrame={navigating ? undefined : resultFrame}
        // Guidance follows the live position: those camera moves are never the saved browsing view.
        onViewChanged={navigating ? undefined : (coordinate, zoom) => camera.viewSettled(toCoordinate(coordinate), zoom)}
        cameraPadding={padding}
        attributionLeft={attributionLeft}
        attributionTop={attributionTop}
        followLocation={navigating ? camera.following : undefined}
        coverageBounds={!navigating && tab === "explore" && search.hasSearch && !selected ? search.result.coverage.bounds : undefined}
        zoom={navigating ? 17 : camera.zoom}
        cameraRevision={camera.revision}
        onMapPress={navigating ? undefined : coordinate => planner.chooseOrigin(toCoordinate(coordinate))}
        onRegionChanged={(coordinate, zoom) => {
          if (navigating) { camera.stopFollowing(); return; }
          userPanned(toCoordinate(coordinate), zoom);
        }}
        onPressMarker={(id) => {
          if (navigating) return;
          if (picking) {
            const marker = markers.find((item) => item.id === id);
            if (marker) planner.chooseOrigin(toCoordinate(marker.coordinate));
            return;
          }
          if (tab === "transit") {
            const next = nearbyStops.find((item) => item.id === id);
            if (next) transit.openStop(next);
          } else {
            const stop = leadStops.find((item) => item.id === id);
            if (stop) { transit.openStop(stop); return; }
            const next = shownPlaces.find((item) => item.id === id);
            if (next) places.openPlace(next);
          }
        }}
      />
    </View>
  );
}
