import type { LineString } from "geojson";
import { useMemo } from "react";
import { View } from "react-native";
import { point, tuple } from "../map/coordinates";
import MapCanvas from "../map/MapCanvas";
import { placeMarker, stopMarker, taskMarkers } from "../map/map-layers";
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
  const markers = useMemo(() => taskMarkers(
    tab === "transit" ? nearbyStops.map(stopMarker) : shownPlaces.map(placeMarker), selected, board,
  ), [tab, nearbyStops, shownPlaces, selected, board]);
  const route = planner.routes.route;
  const routeGeometry = useMemo<LineString | null>(
    () => route && route.geometry.length > 1 ? { type: "LineString", coordinates: route.geometry.map(tuple) } : null,
    [route],
  );
  const navGeometry = navigation.snapshot.route?.geometry;
  const navRoute = useMemo<LineString | null>(() => navGeometry && navGeometry.length > 1
    ? { type: "LineString", coordinates: navGeometry.map(tuple) } : null, [navGeometry]);
  const navCenter = navigation.snapshot.location ?? navigation.snapshot.destination ?? camera.center;
  const navigating = navigation.visible;
  return (
    <View testID="map-viewport" style={{ position: "absolute", top: 0, left: 0, right: 0, height, backgroundColor: theme.map.background }}>
      <MapCanvas
        center={tuple(navigating ? navCenter : camera.center)}
        markers={navigating ? [] : markers}
        selectedMarkerId={journeyStop(tasks)?.id ?? selected?.id ?? selectedStop(tasks)?.id}
        userLocation={navigating ? navigation.snapshot.location ? tuple(navigation.snapshot.location) : null : location.coordinate ? tuple(location.coordinate) : null}
        route={navigating ? navRoute : routeGeometry}
        routeFitKey={navigating ? undefined : planner.fitKey}
        cameraPadding={padding}
        attributionLeft={attributionLeft}
        attributionTop={attributionTop}
        followLocation={navigating ? camera.following : undefined}
        coverageBounds={!navigating && tab === "explore" && search.hasSearch && !selected ? search.result.coverage.bounds : undefined}
        zoom={navigating ? 17 : camera.zoom}
        cameraRevision={camera.revision}
        onMapPress={navigating ? undefined : coordinate => planner.chooseOrigin(point(coordinate))}
        onRegionChanged={(coordinate, zoom) => {
          if (navigating) { camera.stopFollowing(); return; }
          userPanned(point(coordinate), zoom);
        }}
        onPressMarker={(id) => {
          if (navigating) return;
          if (picking) {
            const marker = markers.find((item) => item.id === id);
            if (marker) planner.chooseOrigin(point(marker.coordinate));
            return;
          }
          if (tab === "transit") {
            const next = nearbyStops.find((item) => item.id === id);
            if (next) transit.openStop(next);
          } else {
            const next = shownPlaces.find((item) => item.id === id);
            if (next) places.openPlace(next);
          }
        }}
      />
    </View>
  );
}
