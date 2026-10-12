import "./global.css";
import type { LineString } from "geojson";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { mapCameraPadding } from "./src/components/map-presentation";
import MapCanvas from "./src/components/MapCanvas";
import type { MapMarker } from "./src/components/MapCanvas.types";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Notice,
  Disclosure,
  type IconName,
} from "./src/components/Controls";
import { colors } from "./src/theme/tokens";
import type {
  Coordinate,
  Place,
  SearchPolicy,
  SearchResult,
  Stop,
  TransitTime,
  TravelMode,
} from "./src/domain/types";
import {
  getNearbyStops,
  loadSavedPlaces,
  removeSavedPlace,
  savePlace,
  searchPlaces,
  searchLocalResult,
  categoryLabel,
  DATA_LICENSES,
  PROVIDER_NOTICES,
} from "./src/services";
import { getCurrentLocation, getAuthorizedLocation } from "./src/platform/location";
import { DiagnosticsPanel } from "./src/components/DiagnosticsPanel";
import { DiscoverySettings } from "./src/components/DiscoverySettings";
import { searchPreferences } from "./src/services/search-preferences";
import { JourneyResults, TransitTimeForm } from "./src/components/JourneyPlanner";
import { useRoutePlans } from "./src/components/useRoutePlans";
import { useStopBoard } from "./src/components/useStopBoard";
import { StopBoardPanel } from "./src/components/StopBoardPanel";
import { useAppActive } from "./src/components/useAppActive";
import { routeQueryKey } from "./src/components/route-state";
import { SavedTravelPanel, savedTravelFailureMessage } from "./src/components/SavedTravelPanel";
import { journeyDate, journeyTime } from "./src/components/journey-presentation";
import { savedTravel, type SavedJourney } from "./src/services/saved-travel";
import { useNavigation } from "./src/components/useNavigation";
import { NavigationPanel } from "./src/components/NavigationPanel";
import { NavigationNotices } from "./src/components/NavigationNotices";
import { navigationLocationForReplan } from "./src/domain/navigation";

// A country view is a browsing fallback, never a claimed device position.
const INITIAL_MAP: Coordinate = { latitude: 42.5, longitude: 12.5 };
const tuple = (point: Coordinate): [number, number] => [
  point.longitude,
  point.latitude,
];
const point = (coordinate: [number, number]): Coordinate => ({
  longitude: coordinate[0],
  latitude: coordinate[1],
});
const distance = (meters?: number) =>
  meters == null
    ? ""
    : meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
const duration = (seconds: number) =>
  seconds < 3600
    ? `${Math.max(1, Math.round(seconds / 60))} min`
    : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
const categories: { label: string; query: string; icon: IconName }[] = [
  { label: "Negozi", query: "negozi", icon: "bag-handle-outline" },
  { label: "Farmacie", query: "farmacie", icon: "medical-outline" },
  { label: "Supermercati", query: "supermercato", icon: "basket-outline" },
  { label: "Ristoranti", query: "ristoranti", icon: "restaurant-outline" },
  { label: "Caffè e bar", query: "bar", icon: "cafe-outline" },
];
const modes: { id: TravelMode; label: string; icon: IconName }[] = [
  { id: "walk", label: "A piedi", icon: "walk-outline" },
  { id: "bicycle", label: "Bici", icon: "bicycle-outline" },
  { id: "car", label: "Auto", icon: "car-outline" },
  { id: "transit", label: "Mezzi", icon: "bus-outline" },
];

function MapsApp() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Android resizes the window for the keyboard; the geographic viewport stays put.
  const mapWindow = useRef({ width, height });
  if (width !== mapWindow.current.width || height > mapWindow.current.height) mapWindow.current = { width, height };
  const mapHeight = mapWindow.current.height - insets.top - insets.bottom;
  const availableHeight = height - insets.top - insets.bottom;
  const [following, setFollowing] = useState(true);
  const [frameRevision, setFrameRevision] = useState(0);
  const wide = width >= 850;
  const [tab, setTab] = useState<"explore" | "transit" | "saved">("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const [zoom, setZoom] = useState(5);
  const [cameraRevision, setCameraRevision] = useState(0);
  const cameraTouched = useRef(false);
  const searchTerm = query.trim() || category;
  const hasSearch = searchTerm.length >= 2;
  const [center, setCenterState] = useState(INITIAL_MAP);
  const viewport = useRef(INITIAL_MAP);
  const setCenter = useCallback((next: Coordinate) => { viewport.current = next; setCenterState(next); setCameraRevision(value => value + 1); }, []);
  const locationRequest = useRef(0);
  const [searchCenter, setSearchCenter] = useState(INITIAL_MAP);
  const [areaChanged, setAreaChanged] = useState(false);
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [appMessage, setAppMessage] = useState("");
  const feedback = locationMessage || appMessage;
  const dismissFeedback = () => locationMessage ? setLocationMessage("") : setAppMessage("");
  const preference = useSyncExternalStore(searchPreferences.subscribe, searchPreferences.getSnapshot, searchPreferences.getSnapshot);
  const searchPolicy: SearchPolicy = preference.ready && preference.preferenceKnown ? preference.policy : "local-only";
  const localResult = useMemo(() => searchLocalResult(query.trim() || category, searchCenter), [query, category, searchCenter]);
  const [completedSearch, setCompletedSearch] = useState<{ result: SearchResult; policy: SearchPolicy; local: SearchResult } | null>(null);
  const searchResult = completedSearch?.policy === searchPolicy && completedSearch.local === localResult ? completedSearch.result : localResult;
  const results = searchResult.places;
  const searchWarnings = searchResult.warnings;
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [retrySearch, setRetrySearch] = useState(0);
  const [saved, setSaved] = useState<Place[]>([]);
  const travel = useSyncExternalStore(savedTravel.subscribe, savedTravel.getSnapshot, savedTravel.getSnapshot);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [stopsBusy, setStopsBusy] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [listOnly, setListOnly] = useState(false);
  const detailScroll = useRef<ScrollView>(null);
  const [privacy, setPrivacy] = useState(false);
  const [routeMode, setRouteMode] = useState<TravelMode>("walk");
  const [originPending, setOriginPending] = useState(false);
  const [originReady, setOriginReady] = useState(false);
  const [routeView, setRouteView] = useState(false);
  const [transitTime, setTransitTime] = useState<TransitTime>({ kind: "now" });
  const [origin, setOrigin] = useState<Coordinate>(INITIAL_MAP);
  const [originLabel, setOriginLabel] = useState("Centro della mappa");
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [stop, setStop] = useState<Stop | null>(null);
  const [journeyStop, setJourneyStop] = useState<Stop | null>(null);
  const boardStop = journeyStop ?? stop;
  const suspendActiveWork = useRef(() => {});
  const appActive = useAppActive(active => { if (!active) suspendActiveWork.current(); });
  const navigation = useNavigation(appActive);
  const navigationBack = navigation.back;
  const { route, plans: routePlans, error: routeError, loading: routing, refresh: refreshRoutes, select: selectRoute, reset: resetRoutePlans, restore: restoreRoute, saved: restoredRoute, restoredViewId, retainedSelection, suspend: suspendRoutes } = useRoutePlans({
    from: origin,
    to: selected?.coordinate,
    mode: routeMode,
    transitTime,
    enabled: routeView && originReady,
    active: routeView && !journeyStop && appActive && !privacy && !pickingOrigin && !originPending && !locating && !navigation.visible,
  });
  const stopBoard = useStopBoard({ stopId: boardStop?.id, active: !!boardStop && appActive && !privacy && !navigation.visible && (!!journeyStop || (!routeView && !selected)) });
  const suspendStopBoard = stopBoard.suspend;
  const suspendTransitWork = useCallback(() => {
    suspendRoutes();
    suspendStopBoard();
  }, [suspendRoutes, suspendStopBoard]);
  suspendActiveWork.current = suspendTransitWork;
  const closeJourneyStop = useCallback(() => {
    if (!journeyStop) return;
    suspendStopBoard();
    setJourneyStop(null);
  }, [journeyStop, suspendStopBoard]);
  const resetRoutes = useCallback(() => {
    closeJourneyStop();
    resetRoutePlans();
  }, [closeJourneyStop, resetRoutePlans]);
  const changeStop = useCallback((next: Stop | null) => {
    if (journeyStop || next?.id !== stop?.id) suspendStopBoard();
    setJourneyStop(null);
    setStop(next);
  }, [journeyStop, stop?.id, suspendStopBoard]);
  const [now, setNow] = useState(Date.now());
  const detailKey = privacy ? "privacy" : journeyStop ? `journey-stop:${journeyStop.id}` : routeView ? `route:${selected?.id}`
    : stop ? `stop:${stop.id}` : selected ? `place:${selected.id}` : `list:${tab}`;
  useEffect(() => {
    detailScroll.current?.scrollTo({ y: 0, animated: false });
    setListOnly(false);
  }, [detailKey]);
  const stops = useMemo(
    () => getNearbyStops(searchCenter, { limit: 15, radiusMeters: 1800 }),
    [searchCenter],
  );
  const shownPlaces = useMemo(() => tab === "saved" ? saved : hasSearch ? results : [], [tab, saved, hasSearch, results]);
  const panelVisible = privacy || !!selected || !!stop || routeView || tab !== "explore" || searchOpen || hasSearch;
  const cancelLocationRequest = useCallback(() => {
    locationRequest.current += 1;
    setOriginPending(false);
    setLocating(false);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (navigationBack(stop => Alert.alert("Interrompere la navigazione?", "Puoi continuare a seguire il percorso oppure interrompere la sessione.", [
          { text: "Continua", style: "cancel" },
          { text: "Interrompi", style: "destructive", onPress: stop },
        ], { cancelable: true }))) return true;
        if (pickingOrigin) {
          if (!originReady) { setRouteView(false); resetRoutes(); }
          setPickingOrigin(false);
          return true;
        }
        if (privacy) {
          setPrivacy(false);
          return true;
        }
        if (journeyStop) {
          closeJourneyStop();
          return true;
        }
        if (routeView) {
          cancelLocationRequest();
          setRouteView(false);
          resetRoutes();
          if (selected?.id === "saved-journey-destination") setSelected(null);
          return true;
        }
        if (selected || stop) {
          setSelected(null);
          changeStop(null);
          return true;
        }
        if (listOnly) {
          setListOnly(false);
          return true;
        }
        if (tab === "explore" && (searchOpen || hasSearch)) {
          Keyboard.dismiss(); setSearchOpen(false); setQuery(""); setCategory("");
          return true;
        }
        if (tab !== "explore") {
          setTab("explore");
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [pickingOrigin, privacy, routeView, selected, stop, listOnly, tab, cancelLocationRequest, resetRoutes, changeStop, journeyStop, closeJourneyStop, navigationBack, searchOpen, hasSearch, originReady]);
  useEffect(() => {
    void searchPreferences.initialize(AsyncStorage);
    void savedTravel.initialize(AsyncStorage);
  }, []);
  useEffect(() => {
    if (restoredViewId !== null && travel.journeyStatus === "ready" && !travel.journey) {
      cancelLocationRequest();
      resetRoutes();
      setRouteView(false);
      setSelected(null);
    }
  }, [restoredViewId, travel.journeyStatus, travel.journey, cancelLocationRequest, resetRoutes]);
  useEffect(() => {
    loadSavedPlaces()
      .then(setSaved)
      .catch(() =>
        setAppMessage(
          "Impossibile leggere i luoghi salvati su questo dispositivo.",
        ),
      );
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tab !== "explore" || navigation.visible || !hasSearch || !appActive) { setSearching(false); return; }
    const controller = new AbortController();
    // A switch change aborts now, without waiting for React's effect cleanup.
    const unsubscribe = searchPreferences.subscribe(() => {
      const current = searchPreferences.getSnapshot();
      if (!current.ready || !current.preferenceKnown || current.policy !== searchPolicy) controller.abort();
    });
    setSearchError("");
    setCompletedSearch({ result: localResult, policy: searchPolicy, local: localResult });
    if (!preference.ready || searchPolicy === "local-only") {
      setSearching(false);
      return () => { unsubscribe(); controller.abort(); };
    }
    setSearching(true);
    const timer = setTimeout(
      () => {
        searchPlaces(query.trim() || category, {
          center: searchCenter,
          signal: controller.signal,
          policy: searchPolicy,
        })
          .then((result) => {
            if (!controller.signal.aborted) {
              setCompletedSearch({ result, policy: searchPolicy, local: localResult });
            }
          })
          .catch((error) => {
            if (!controller.signal.aborted) {
              setSearchError(
                error instanceof Error
                  ? error.message
                  : "Ricerca non disponibile.",
              );
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearching(false);
          });
      },
      query ? 450 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      unsubscribe();
    };
  }, [query, category, searchCenter, retrySearch, tab, preference.ready, searchPolicy, localResult, navigation.visible, hasSearch, appActive]);

  useEffect(() => {
    if (!appActive) { cancelLocationRequest(); setLocation(null); return; }
    if (navigation.visible) return;
    let active = true;
    const request = locationRequest.current;
    setLocating(true);
    void getAuthorizedLocation().then(position => {
      if (!active || !position) return;
      setLocationMessage("");
      const next = point(position.coordinate);
      setLocation(next);
      if (!cameraTouched.current && request === locationRequest.current) {
        setCenter(next);
        setZoom(15);
        viewport.current = next;
        setSearchCenter(next);
      }
    }).catch(error => {
      if (active && request === locationRequest.current) {
        setLocation(null);
        setLocationMessage(error instanceof Error ? error.message : "Posizione non disponibile. Riprova dal pulsante posizione.");
      }
    }).finally(() => {
      if (active && request === locationRequest.current) setLocating(false);
    });
    return () => { active = false; };
  }, [appActive, navigation.visible, cancelLocationRequest, setCenter]);


  async function locate() {
    cameraTouched.current = true;
    if (journeyStop) closeJourneyStop();
    if (routeView) { suspendRoutes(); setOriginPending(true); setOriginReady(false); }
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationMessage("");
    try {
      const position = await getCurrentLocation();
      if (request !== locationRequest.current) return;
      const next = point(position.coordinate);
      setLocation(next);
      setCenter(next);
      setZoom(15);
      viewport.current = next;
      setSearchCenter(next);
      setAreaChanged(false);
      if (routeView) {
        setOrigin(next);
        setOriginReady(true);
        setOriginLabel("La tua posizione");
        setPickingOrigin(false);
      }
    } catch (error) {
      if (request !== locationRequest.current) return;
      if (routeView) setPickingOrigin(true);
      setLocationMessage(
        error instanceof Error
          ? error.message
          : "Posizione non disponibile. Puoi continuare a esplorare la mappa.",
      );
    } finally {
      if (request === locationRequest.current) { setLocating(false); setOriginPending(false); }
    }
  }
  function openPlace(place: Place) {
    cancelLocationRequest();
    cameraTouched.current = true;
    setZoom(15);
    setSearchOpen(false);
    Keyboard.dismiss();
    setSelected(place);
    setPickingOrigin(false);
    setRouteView(false);
    resetRoutes();
    setCenter(place.coordinate);
    setListOnly(false);
    changeStop(null);
  }
  function changeTab(next: typeof tab) {
    cameraTouched.current = true;
    setSearchOpen(false);
    setListOnly(false);
    if (next === "explore") { setQuery(""); setCategory(""); }
    if (next === "transit") { setSearchCenter(viewport.current); setAreaChanged(false); }
    cancelLocationRequest();
    Keyboard.dismiss();
    setTab(next);
    setSelected(null);
    changeStop(null);
    setRouteView(false);
    resetRoutes();
    setPickingOrigin(false);
    setPrivacy(false);
  }
  async function toggleSaved(place: Place) {
    try {
      setSaved(
        await (saved.some((item) => item.id === place.id)
          ? removeSavedPlace(place.id)
          : savePlace(place)),
      );
    } catch {
      setAppMessage("Salvataggio non riuscito. Riprova.");
    }
  }
  function openJourneyStop(current: Stop) {
    cancelLocationRequest();
    suspendTransitWork();
    setJourneyStop(current);
    cameraTouched.current = true;
    setZoom(15);
    setCenter(current.coordinate);
    setListOnly(false);
  }
  function openSavedJourney(journey: SavedJourney) {
    cancelLocationRequest();
    Keyboard.dismiss();
    setTab("saved");
    changeStop(null);
    setPrivacy(false);
    setPickingOrigin(false);
    setOrigin(journey.query.from);
    setOriginReady(true);
    setOriginLabel(journey.originLabel);
    setSelected({
      id: "saved-journey-destination", name: journey.destinationLabel,
      coordinate: journey.query.to, source: journey.plan.source,
      attributions: ["Dati © OpenStreetMap contributors"],
    });
    setRouteMode(journey.query.mode);
    setTransitTime(journey.query.transitTime);
    cameraTouched.current = true;
    setZoom(15);
    setCenter(journey.query.to);
    setListOnly(false);
    setRouteView(true);
    restoreRoute(journey);
  }
  async function saveSelectedJourney() {
    if (!route || !selected || journeyBusy || retainedSelection) return;
    setJourneyBusy(true);
    try {
      await savedTravel.saveJourney({
        query: { from: origin, to: selected.coordinate, mode: routeMode, transitTime },
        originLabel, destinationLabel: selected.name, plan: route,
      });
    } finally { setJourneyBusy(false); }
  }
  async function clearSavedJourney() {
    if (journeyBusy) return;
    setJourneyBusy(true);
    try { await savedTravel.clearJourney(); }
    finally { setJourneyBusy(false); }
  }
  async function mutateSavedStops(action: () => Promise<boolean>) {
    if (stopsBusy) return;
    setStopsBusy(true);
    try { await action(); }
    finally { setStopsBusy(false); }
  }
  function openSavedStop(current: Stop) {
    cancelLocationRequest();
    setSelected(null);
    setRouteView(false);
    resetRoutes();
    setPickingOrigin(false);
    changeStop(current);
    cameraTouched.current = true;
    setZoom(15);
    setCenter(current.coordinate);
    setListOnly(false);
  }
  function searchArea() {
    cancelLocationRequest();
    setSearchCenter(viewport.current);
    setAreaChanged(false);
    setSelected(null);
    changeStop(null);
    setRouteView(false);
    resetRoutes();
  }
  async function beginRoute(destination?: Place) {
    if (destination) openPlace(destination);
    const request = ++locationRequest.current;
    resetRoutes();
    setOriginReady(false);
    setOrigin(viewport.current);
    setOriginLabel("Punto da scegliere sulla mappa");
    setRouteView(true);
    setPickingOrigin(!location);
    if (!location) return;
    setOriginPending(true);
    setLocating(true);
    try {
      const fresh = await getCurrentLocation();
      if (request !== locationRequest.current) return;
      const next = point(fresh.coordinate);
      setLocation(next);
      setOrigin(next);
      setOriginReady(true);
      setOriginLabel("La tua posizione");
    } catch {
      if (request !== locationRequest.current) return;
      setPickingOrigin(true);
      setLocationMessage("Posizione non aggiornata. Riprova oppure scegli il punto di partenza sulla mappa.");
    } finally {
      if (request === locationRequest.current) {
        setOriginPending(false);
        setLocating(false);
      }
    }
  }
  async function replanTransitNavigation() {
    const current = navigation.snapshot;
    cancelLocationRequest();
    suspendTransitWork();
    // Keep preview requests suspended while Stop settles and the new origin is chosen.
    setPickingOrigin(true);
    if (!await navigation.stop()) return;
    const from = navigationLocationForReplan(current);
    setOriginReady(!!from);
    if (from) {
      setOrigin(from);
      setOriginLabel("La tua posizione alla richiesta di aggiornamento");
      setLocation(from);
      setCenter(from);
    }
    if (current.destination && (selected?.coordinate.latitude !== current.destination.latitude || selected?.coordinate.longitude !== current.destination.longitude)) setSelected({ id: "navigation-destination", name: "Destinazione del viaggio", coordinate: current.destination, source: "MATO / 5T", attributions: [] });
    setRouteMode("transit");
    setTransitTime({ kind: "now" });
    setRouteView(true);
    setPickingOrigin(!from);
    setPrivacy(false);
    resetRoutes();
  }
  async function openLink(url: string) {
    if (!/^(https?:|tel:)/i.test(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      setAppMessage("Impossibile aprire questo collegamento.");
    }
  }
  const onMapPress = (coordinate: [number, number]) => {
    if (pickingOrigin) {
      cancelLocationRequest();
      setOrigin(point(coordinate));
      setOriginReady(true);
      setOriginLabel("Punto scelto sulla mappa");
      setPickingOrigin(false);
    }
  };
  const title = privacy
    ? "Privacy e fonti"
    : journeyStop
      ? journeyStop.name
      : routeView
        ? "Il tuo percorso"
        : selected
          ? selected.name
          : stop
            ? stop.name
            : tab === "transit"
              ? "Trasporti"
              : tab === "saved"
                ? "I tuoi salvati"
                : query.trim()
                  ? query.trim()
                  : categories.find(item => item.query === category)?.label ?? "Cerca sulla mappa";
  const isSaved = selected
    ? saved.some((item) => item.id === selected.id)
    : false;
  const savedJourneyVisible = !!route && (restoredRoute || (!!travel.journey && !!selected
    && travel.journey.plan.id === route.id && travel.journey.plan.fetchedAt === route.fetchedAt
    && routeQueryKey(travel.journey.query) === routeQueryKey({ from: origin, to: selected.coordinate, mode: routeMode, transitTime })));
  const journeySaveError = savedTravelFailureMessage(travel.journeyFailure);
  const stopSaveError = savedTravelFailureMessage(travel.stopsFailure);
  const stopSaved = !!boardStop && travel.stops.some(entry => entry.current?.id === boardStop.id);
  const routeGeometry = useMemo<LineString | null>(
    () =>
      route && route.geometry.length > 1
        ? { type: "LineString", coordinates: route.geometry.map(tuple) }
        : null,
    [route],
  );
  const mapMarkers = useMemo(() => {
    const markers: MapMarker[] = selected || boardStop ? [] :
      tab === "transit"
        ? stops.map((item) => ({
            id: item.id,
            coordinate: tuple(item.coordinate),
            kind: "stop" as const,
            label: item.name,
          }))
        : shownPlaces.map((item) => ({
            id: item.id,
            coordinate: tuple(item.coordinate),
            kind: "place" as const,
            label: item.name,
          }));
    if (selected && !markers.some((item) => item.id === selected.id))
      markers.push({
        id: selected.id,
        coordinate: tuple(selected.coordinate),
        kind: "place",
        label: selected.name,
      });
    if (boardStop && !markers.some(item => item.id === boardStop.id)) markers.push({
      id: boardStop.id, coordinate: tuple(boardStop.coordinate), kind: "stop", label: boardStop.name,
    });

    return markers;
  }, [tab, stops, shownPlaces, selected, boardStop]);

  const navigationOverlay = <NavigationPanel {...navigation} following={following} onRecenter={() => { setFollowing(true); setCameraRevision(value => value + 1); }}
    onStop={() => { void navigation.stop(); }} onRetry={() => { void navigation.retry(); }} onMute={() => { void navigation.toggleMuted(); }}
    onConfirmTransit={action => { void navigation.confirmTransit(action); }} onReplan={() => { void replanTransitNavigation(); }} />;

  const navGeometry = navigation.snapshot.route?.geometry;
  const navRoute = useMemo<LineString | null>(() => navGeometry && navGeometry.length > 1
    ? { type: "LineString", coordinates: navGeometry.map(tuple) } : null, [navGeometry]);
  const navCenter = navigation.snapshot.location ?? navigation.snapshot.destination ?? center;
  const sheetHeight = wide ? availableHeight - 144 : Math.min(availableHeight - 192, listOnly ? availableHeight - 192 : Math.max(300, Math.min(420, mapHeight * 0.46)));
  const mapPadding = mapCameraPadding({ width, height: mapHeight, sheetHeight, panelVisible, navigating: navigation.visible, fontScale });
  const fitKey = routeView && selected && originReady ? `${routeQueryKey({ from: origin, to: selected.coordinate, mode: routeMode, transitTime })}:${frameRevision}` : undefined;
  function closePanel() { changeTab("explore"); searchInput.current?.blur(); }
  function backPanel() {
    if (privacy) setPrivacy(false);
    else if (journeyStop) closeJourneyStop();
    else if (routeView) {
      cancelLocationRequest(); setRouteView(false); resetRoutes(); setPickingOrigin(false);
      if (selected?.id === "saved-journey-destination") setSelected(null);
    } else if (selected || stop) { setSelected(null); changeStop(null); }
    else closePanel();
  }
  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View className="flex-1">
        <View testID="map-viewport" style={{ position: "absolute", top: 0, left: 0, right: 0, height: mapHeight, backgroundColor: "#DFE8EB" }}>
            <MapCanvas
              center={tuple(navigation.visible ? navCenter : center)}
              markers={navigation.visible ? [] : mapMarkers}
              selectedMarkerId={journeyStop?.id ?? selected?.id ?? stop?.id}
              userLocation={navigation.visible ? navigation.snapshot.location ? tuple(navigation.snapshot.location) : null : location ? tuple(location) : null}
              route={navigation.visible ? navRoute : routeGeometry}
              routeFitKey={navigation.visible ? undefined : fitKey}
              cameraPadding={mapPadding}
              attributionLeft={wide && panelVisible && !navigation.visible ? 430 : 8}
              attributionTop={navigation.visible ? Math.min(height * 0.3, 156 * Math.min(fontScale, 1.5)) + 8 : 68}
              followLocation={navigation.visible ? following : undefined}
              coverageBounds={!navigation.visible && tab === "explore" && hasSearch && !routeView && !selected ? searchResult.coverage.bounds : undefined}
              zoom={navigation.visible ? 17 : zoom}
              cameraRevision={cameraRevision}
              onMapPress={navigation.visible ? undefined : onMapPress}
              onRegionChanged={(coordinate) => {
                if (navigation.visible) { setFollowing(false); return; }
                cameraTouched.current = true;
                cancelLocationRequest();
                if (routeView && !originReady) setPickingOrigin(true);
                viewport.current = point(coordinate);
                if (
                  Math.abs(coordinate[0] - searchCenter.longitude) +
                    Math.abs(coordinate[1] - searchCenter.latitude) >
                  0.004
                )
                  setAreaChanged(true);
              }}
              onPressMarker={(id) => {
                if (navigation.visible) return;
                if (pickingOrigin) {
                  const marker = mapMarkers.find((item) => item.id === id);
                  if (marker) onMapPress(marker.coordinate);
                  return;
                }
                if (tab === "transit") {
                  const next = stops.find((item) => item.id === id);
                  if (next) openSavedStop(next);
                } else {
                  const next = shownPlaces.find((item) => item.id === id);
                  if (next) openPlace(next);
                }
              }}
            />
        </View>
        {navigation.visible ? navigationOverlay : <>
            <View
              pointerEvents="box-none"
              className="absolute left-3 right-3 top-20 flex-row items-start justify-between"
            >
              <View className="flex-1" pointerEvents="none">
                {locating ? <Text accessibilityLiveRegion="polite" className="self-start rounded-lg bg-white px-3 py-2 text-sm text-[#59667A]">Ricerca della posizione…</Text> : null}
              </View>
              <View
                style={{
                  elevation: 3,
                  boxShadow: "0 2px 8px #17243c18",
                  borderRadius: 24,
                }}
              >
                {locating ? (
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
                    <ActivityIndicator color={colors.blue} />
                  </View>
                ) : (
                  <IconButton
                    icon="locate-outline"
                    label="Usa la mia posizione"
                    onPress={locate}
                  />
                )}
              </View>
            </View>
            {feedback && !pickingOrigin ? <View style={{ bottom: !wide && panelVisible ? sheetHeight + 80 : 88, left: wide && panelVisible ? 442 : 16, right: 16 }} className="absolute left-4 right-4"><Notice text={feedback} action="Chiudi" onAction={dismissFeedback} /></View> : null}
            {pickingOrigin ? (
              <View style={{ bottom: !wide && panelVisible ? sheetHeight + 80 : 88, left: wide && panelVisible ? 442 : 16, right: 16 }} className="absolute left-4 right-4">
                <Notice
                  text={feedback ? `${feedback} Tocca la mappa per scegliere la partenza.` : "Tocca la mappa per scegliere il punto di partenza."}
                  action="Annulla"
                  onAction={() => { if (!originReady) { setRouteView(false); resetRoutes(); } setPickingOrigin(false); }}
                />
              </View>
            ) : areaChanged && (hasSearch || tab === "transit") && !selected && !stop ? (
              <View style={{ bottom: !wide && panelVisible ? sheetHeight + 80 : 88, left: wide && panelVisible ? 442 : 16, right: 16 }} className="absolute max-w-[95%] self-center rounded-2xl bg-white">
                <Button icon="search-outline" secondary onPress={searchArea}>
                  Cerca in quest’area
                </Button>
                <Text className="px-3 pb-2 text-center text-xs text-[#59667A]">{tab === "transit" ? "Fermate intorno al centro" : searchResult.coverage.radiusMeters !== null ? `Raggio ${distance(searchResult.coverage.radiusMeters)} dal centro` : searchPolicy === "local-only" ? "Nomi nell’intero pacchetto locale" : "Nomi nel pacchetto; area come riferimento online"}</Text>
              </View>
            ) : null}
      <View className="absolute left-0 right-0 top-0 px-3 py-2">
        <View className="flex-row items-center gap-2">
          <View className="min-h-12 min-w-0 flex-1 flex-row items-center rounded-2xl bg-white pl-1 pr-1 border border-[#E2E8F0]">
            {searchOpen || hasSearch ? <IconButton icon="arrow-back" label="Chiudi ricerca" onPress={() => { changeTab("explore"); searchInput.current?.blur(); }} /> : <View className="h-12 w-12 items-center justify-center"><Icon name="search-outline" color={colors.muted} size={21} /></View>}
            <TextInput
              ref={searchInput}
              onFocus={() => { cameraTouched.current = true; cancelLocationRequest(); setSearchCenter(viewport.current); setAreaChanged(false); setSearchOpen(true); setPrivacy(false); setSelected(null); changeStop(null); setRouteView(false); setPickingOrigin(false); resetRoutes(); setTab("explore"); }}
              accessibilityLabel="Cerca luoghi, indirizzi o attività"
              className="min-h-12 min-w-0 flex-1 px-3 text-base text-[#17243C]"
              placeholder="Cerca un luogo o indirizzo"
              placeholderTextColor={colors.muted}
              value={query}
              returnKeyType="search"
              autoCorrect={false}
              onChangeText={(value) => {
                cancelLocationRequest();
                cameraTouched.current = true;
                setSearchOpen(true);
                setCategory("");
                setListOnly(false);
                setQuery(value);
                setTab("explore");
                setSelected(null);
                changeStop(null);
                setRouteView(false);
                setPickingOrigin(false);
                resetRoutes();
                setPrivacy(false);
              }}
              onSubmitEditing={() => {
                if (journeyStop) closeJourneyStop();
                Keyboard.dismiss();
                setRetrySearch((value) => value + 1);
              }}
            />
            {query ? (
              <IconButton
                icon="close"
                label="Cancella ricerca"
                onPress={() => { changeTab("explore"); searchInput.current?.blur(); }}
              />
            ) : null}
          </View>
          <IconButton
            icon="options-outline"
            label="Privacy e fonti"
            active={privacy}
            onPress={() => { Keyboard.dismiss(); if (!privacy) suspendTransitWork(); setPrivacy((value) => !value); }}
          />
        </View>

      </View>

        {panelVisible ? <View testID="map-sheet" style={{ position: "absolute", left: wide ? 12 : 0, right: wide ? undefined : 0, bottom: 64, width: wide ? 410 : undefined, height: sheetHeight, borderColor: colors.line, borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" }} className="bg-white">
          <View className="h-3 items-center justify-center"><View className="h-1 w-8 rounded-full bg-[#E2E8F0]" /></View>
          <View style={{ height: Math.max(56, 48 * fontScale) }} className="flex-row items-center border-b border-[#E2E8F0] px-2">
            <IconButton icon="arrow-back" label="Indietro" onPress={backPanel} />
            <Text accessibilityRole="header" numberOfLines={2} className="min-w-0 flex-1 text-base leading-5 font-semibold text-[#17243C]">{title}</Text>
            {!wide ? <IconButton icon={listOnly ? "chevron-down" : "chevron-up"} label={listOnly ? "Riduci scheda" : "Espandi scheda"} onPress={() => { Keyboard.dismiss(); setListOnly(value => !value); }} /> : null}
            <IconButton icon="close" label="Chiudi scheda" onPress={closePanel} />
          </View>
          <ScrollView
            ref={detailScroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {!privacy && !selected && !stop && tab === "explore" && hasSearch ? <View className="h-9 flex-row items-center gap-2 px-4">
              <View className="w-4">{searching ? <ActivityIndicator size="small" color={colors.blue} /> : null}</View>
              <Text numberOfLines={1} accessibilityLiveRegion="polite" className="flex-1 text-xs text-[#59667A]">{searching ? "Aggiorno i risultati…" : `${shownPlaces.length} risultati${searchResult.truncated ? ` · primi ${searchResult.resultLimit}` : ""}${searchPolicy === "local-only" ? " · solo locali" : ""}`}</Text>
            </View> : null}
            {privacy ? (
              <PrivacyContent onLink={openLink} />
            ) : routeView && selected && !journeyStop ? (
              <View className="gap-3 p-4">
                {savedJourneyVisible ? <Notice text="Viaggio salvato · da aggiornare" /> : null}
                {retainedSelection ? <Notice text="Scegli un’alternativa aggiornata: il viaggio selezionato non compare più nei risultati recenti." /> : null}
                {navigation.error ? <Notice danger text={navigation.error} action="Impostazioni app" onAction={() => { void Linking.openSettings(); }} /> : null}
                <View className="flex-row items-center gap-2 border-b border-[#E2E8F0] pb-2">
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-sm text-[#59667A]">Da: {originLabel}</Text>
                    <Text numberOfLines={1} className="mt-1 text-sm font-semibold text-[#17243C]">A: {selected.name}</Text>
                  </View>
                  <IconButton icon="locate-outline" label="Parti dalla mia posizione" disabled={locating} onPress={locate} />
                  <IconButton icon="map-outline" label="Scegli la partenza sulla mappa" onPress={() => { cancelLocationRequest(); suspendRoutes(); setPickingOrigin(true); setListOnly(false); }} />
                </View>
                <View className="flex-row rounded-2xl bg-[#F3F6FA] p-1">
                  {modes.map((mode) => (
                    <Pressable
                      key={mode.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: routeMode === mode.id }}
                      onPress={() => { if (routeMode !== mode.id) suspendRoutes(); setRouteMode(mode.id); }}
                      className={`min-h-12 flex-1 items-center justify-center gap-1 rounded-xl ${routeMode === mode.id ? "bg-white" : ""}`}
                    >
                      <Icon
                        name={mode.icon}
                        color={
                          routeMode === mode.id ? colors.blue : colors.muted
                        }
                      />
                      <Text
                        className={`text-xs ${routeMode === mode.id ? "font-semibold text-[#2359D7]" : "text-[#59667A]"}`}
                      >
                        {mode.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {routeMode === "transit" ? (
                  <TransitTimeForm
                    key={JSON.stringify(transitTime)}
                    value={transitTime}
                    disabled={routing || originPending || pickingOrigin}
                    onSubmit={(value) => {
                      if (JSON.stringify(value) === JSON.stringify(transitTime)) refreshRoutes();
                      else { suspendRoutes(); setTransitTime(value); }
                    }}
                  />
                ) : null}
                {pickingOrigin ? (
                  <Notice text="Scegli la partenza sulla mappa per calcolare il percorso." />
                ) : routeMode === "transit" && route ? (
                  <JourneyResults
                    plans={routePlans}
                    selected={route}
                    onSelect={id => { selectRoute(id); setFrameRevision(value => value + 1); }}
                    onRefresh={refreshRoutes}
                    loading={routing}
                    error={routeError}
                    now={now}
                    query={transitTime}
                    saved={savedJourneyVisible}
                    retained={retainedSelection}
                    onOpenStop={openJourneyStop}
                  />
                ) : (routing && !route) || originPending ? (
                  <Loading label="Calcolo del percorso…" />
                ) : routeError && !route ? (
                  <Notice
                    danger
                    text={routeError}
                    action="Riprova"
                    onAction={refreshRoutes}
                  />
                ) : route ? (
                  <Disclosure title="Indicazioni e fonti del percorso">
                    <Text className="text-xs leading-5 text-[#59667A]">Consultato il {journeyDate(route.fetchedAt)} alle {journeyTime(route.fetchedAt)}. {savedJourneyVisible ? "Da aggiornare." : ""}</Text>
                    {routeError ? <Notice danger text={`Aggiornamento non riuscito. ${routeError} Il percorso precedente resta visibile. Il prossimo tentativo può richiedere qualche minuto.`} /> : null}
                    <Button secondary icon="refresh-outline" loading={routing} onPress={refreshRoutes}>Ricalcola percorso</Button>
                    {route.warnings.map((warning, index) => (
                      <Notice key={index} text={warning} />
                    ))}
                    {route.legs.map((leg, index) => (
                      <View
                        key={index}
                        className="border-t border-[#E2E8F0] pt-4"
                      >
                        {leg.steps.map((step, stepIndex) => (
                          <View
                            key={stepIndex}
                            className="min-h-14 flex-row items-center gap-3 border-b border-[#F3F6FA] py-3"
                          >
                            <Icon
                              name={
                                stepIndex === leg.steps.length - 1
                                  ? "flag-outline"
                                  : "arrow-up-outline"
                              }
                              size={19}
                              color={colors.blue}
                            />
                            <Text className="flex-1 text-sm leading-5 text-[#17243C]">
                              {step.instruction}
                            </Text>
                            <Text className="text-xs text-[#59667A]">
                              {distance(step.distanceMeters)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                    <Text className="text-xs leading-5 text-[#59667A]">
                      Anteprima del percorso. Per le indicazioni durante il viaggio usa Avvia navigazione su Android. Percorso: {route.source}. Dati © OpenStreetMap
                      contributors.
                    </Text>
                  </Disclosure>
                ) : !originPending ? (
                  <Button secondary icon="refresh-outline" onPress={refreshRoutes}>Calcola percorso</Button>
                ) : null}
                <Disclosure title="Come funziona la navigazione">
                  <Text className="text-sm leading-5 text-[#59667A]">L’anteprima serve a pianificare. Avvia navigazione su Android richiede una posizione precisa attuale; per i percorsi stradali viene calcolata una nuova partenza. Android può chiedere posizione e notifiche. Con i mezzi confermi salita e discesa; un viaggio non aggiornato o distante va ricalcolato.</Text>
                </Disclosure>
                {route && !pickingOrigin && !originPending ? (
                  <View className="gap-3 border-t border-[#E2E8F0] pt-4">
                    <Text className="text-xs leading-5 text-[#59667A]">Copia locale con gli orari consultati, da aggiornare prima del viaggio.</Text>
                    {journeySaveError ? <Notice danger text={journeySaveError} /> : null}
                    {savedJourneyVisible ? (
                      <Button secondary icon="trash-outline" loading={journeyBusy} onPress={clearSavedJourney}>Rimuovi viaggio salvato</Button>
                    ) : (
                      <Button secondary icon="bookmark-outline" loading={journeyBusy} disabled={routing || retainedSelection || travel.journeyStatus === "loading"} onPress={saveSelectedJourney}>
                        {travel.journey || travel.journeyStatus === "unavailable" ? "Sostituisci viaggio salvato" : "Salva viaggio selezionato"}
                      </Button>
                    )}
                  </View>
                ) : null}
              </View>
            ) : selected && !journeyStop ? (
              <View className="gap-3 p-4">
                <View>
                  <Text className="text-base text-[#59667A]">
                    {categoryLabel(selected.category)}
                    {selected.distanceMeters != null
                      ? ` · ${distance(selected.distanceMeters)}`
                      : ""}
                  </Text>
                  {selected.address ? (
                    <Text className="mt-2 text-sm leading-5 text-[#17243C]">
                      {selected.address}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Button
                      icon="arrow-up-outline"
                      onPress={() => beginRoute()}
                    >
                      Indicazioni
                    </Button>
                  </View>
                  <Button
                    secondary
                    icon={isSaved ? "bookmark" : "bookmark-outline"}
                    onPress={() => toggleSaved(selected)}
                  >
                    {isSaved ? "Salvato" : "Salva"}
                  </Button>
                </View>
                {selected.website ? (
                  <ActionRow
                    icon="globe-outline"
                    title="Sito web"
                    subtitle={selected.website.replace(/^https?:\/\//, "")}
                    onPress={() => openLink(selected.website!)}
                  />
                ) : null}
                {selected.phone ? (
                  <ActionRow
                    icon="call-outline"
                    title="Chiama"
                    subtitle={selected.phone}
                    onPress={() => openLink(`tel:${selected.phone}`)}
                  />
                ) : null}
                <Text className="text-xs text-[#59667A]">Orari non disponibili</Text>
                <Disclosure title="Fonti e aggiornamento">
                <Text className="text-xs leading-5 text-[#59667A]">
                  Fonte: {selected.source}
                  {selected.dataUpdatedAt
                    ? `\nDati del ${selected.dataUpdatedAt}`
                    : ""}
                  {selected.attributions.length
                    ? `\n${selected.attributions.join("\n")}`
                    : ""}
                </Text>
                </Disclosure>
                <Pressable
                  accessibilityRole="link"
                  className="min-h-12 justify-center"
                  onPress={() =>
                    openLink(
                      `https://www.openstreetmap.org/?mlat=${selected.coordinate.latitude}&mlon=${selected.coordinate.longitude}#map=19/${selected.coordinate.latitude}/${selected.coordinate.longitude}`,
                    )
                  }
                >
                  <Text className="text-sm font-semibold text-[#2359D7]">
                    Visualizza su OpenStreetMap
                  </Text>
                </Pressable>
              </View>
            ) : boardStop ? (
              <View className="gap-3 p-4">
                {stopSaveError ? <Notice danger text={stopSaveError} /> : null}
                <Button
                  secondary icon={stopSaved ? "bookmark" : "bookmark-outline"}
                  loading={stopsBusy} disabled={travel.stopsStatus === "loading"}
                  onPress={() => mutateSavedStops(() => stopSaved ? savedTravel.removeStop(boardStop.id) : savedTravel.saveStop(boardStop.id))}
                >{stopSaved ? "Rimuovi fermata salvata" : "Salva fermata"}</Button>
                <StopBoardPanel stop={boardStop} state={stopBoard} now={now} onLink={openLink}
                  onDirections={() => {
                    const next: Place = {
                      id: `stop:${boardStop.id}`, name: `Fermata ${boardStop.name}`, coordinate: boardStop.coordinate,
                      category: "Fermata GTT", source: "GTT", attributions: ["Dati GTT"],
                    };
                    setRouteMode("walk");
                    beginRoute(next);
                  }}
                />
              </View>
            ) : tab === "transit" ? (
              <>
                <View className="mx-5 mt-4">
                  <Notice text="Scegli una fermata per gli arrivi GTT. Per un itinerario con i mezzi, cerca una destinazione e apri Indicazioni." />
                </View>
                {stops.length ? (
                  stops.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      key={item.id}
                      onPress={() => {
                        changeStop(item);
                        cameraTouched.current = true;
                        setZoom(15);
                        setCenter(item.coordinate);
                        setListOnly(false);
                      }}
                      className="mx-5 min-h-20 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
                    >
                      <View className="h-11 w-11 items-center justify-center rounded-xl bg-[#FFF5DE]">
                        <Icon name="bus-outline" color={colors.amber} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-[#17243C]">
                          {item.name}
                        </Text>
                        <Text className="mt-1 text-xs text-[#59667A]">
                          {item.code} ·{" "}
                          {item.lines.slice(0, 6).join(", ") || "Fermata GTT"}
                        </Text>
                      </View>
                      <Text className="text-xs text-[#59667A]">
                        {distance(item.distanceMeters)}
                      </Text>
                      <Icon
                        name="chevron-forward"
                        size={16}
                        color={colors.muted}
                      />
                    </Pressable>
                  ))
                ) : (
                  <EmptyState
                    icon="bus-outline"
                    title="Nessuna fermata in quest’area"
                    description="Sposta la mappa verso Torino e cerca di nuovo nell’area."
                  />
                )}
              </>
            ) : tab === "explore" && !hasSearch ? (
              <View className="px-5 py-3">
                <Text className="mb-3 text-sm leading-5 text-[#59667A]">Scrivi un nome o un indirizzo, oppure scegli cosa cercare nell’area.</Text>
                {categories.map(item => <Pressable key={item.query} accessibilityRole="button" onPress={() => {
                  Keyboard.dismiss(); setQuery(""); setCategory(item.query); setSearchOpen(false);
                  setSearchCenter(viewport.current); setAreaChanged(false);
                }} className="min-h-12 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3">
                  <Icon name={item.icon} size={20} color={colors.muted} />
                  <Text className="flex-1 text-base text-[#17243C]">{item.label}</Text>
                  <Icon name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>)}
              </View>
            ) : (
              <>
                {tab === "saved" ? <SavedTravelPanel
                  snapshot={travel} journeyBusy={journeyBusy} stopsBusy={stopsBusy}
                  onOpenJourney={openSavedJourney} onClearJourney={clearSavedJourney}
                  onOpenStop={openSavedStop}
                  onRemoveStop={id => mutateSavedStops(() => savedTravel.removeStop(id))}
                  onClearStops={() => mutateSavedStops(() => savedTravel.clearStops())}
                /> : null}
                {searching && !shownPlaces.length && tab === "explore" ? (
                  <Loading label="Cerco nell’area…" />
                ) : searchError && tab === "explore" ? (
                  <View className="m-5">
                    <Notice
                      danger
                      text={searchError}
                      action="Riprova"
                      onAction={() => setRetrySearch((value) => value + 1)}
                    />
                  </View>
                ) : shownPlaces.length ? (
                  shownPlaces.map((place) => (
                    <PlaceRow
                      key={place.id}
                      place={place}
                      saved={saved.some((item) => item.id === place.id)}
                      onPress={() => openPlace(place)}
                    />
                  ))
                ) : (
                  <EmptyState
                    icon={
                      tab === "saved" ? "bookmark-outline" : "search-outline"
                    }
                    title={
                      tab === "saved"
                        ? "Tieni a portata i tuoi posti"
                        : searchResult.coverage.extent === "outside" ? "Fuori dal pacchetto locale" : "Nessuna corrispondenza"
                    }
                    description={
                      tab === "saved"
                        ? "Apri un luogo e tocca Salva. Lo ritrovi qui, senza account."
                        : searchResult.coverage.extent === "outside"
                          ? "Il raggio di ricerca non raggiunge il pacchetto. Torna verso il confine tratteggiato sulla mappa: l’assenza di risultati non indica che non ci siano attività."
                          : searchPolicy === "local-only"
                            ? "Il luogo può mancare nel pacchetto. Prova un altro nome o una categoria. Puoi abilitare la ricerca online in Privacy e fonti."
                            : "Prova un altro nome o una categoria. Le fonti possono essere incomplete: nessun risultato non significa che il luogo sia chiuso."
                    }
                  />
                )}
                {tab === "explore" ? <View className="px-4"><Disclosure title="Copertura e fonti">
                  <Text className="text-xs leading-5 text-[#59667A]">{searchResult.coverage.radiusMeters !== null
                    ? `Raggio ${distance(searchResult.coverage.radiusMeters)} · ${searchResult.coverage.extent === "outside" ? "fuori dal pacchetto locale" : searchResult.coverage.extent === "partial" ? "copertura locale parziale" : "nel pacchetto locale"}`
                    : `Nomi nel pacchetto locale${searchResult.coverage.centerInside ? "" : " · centro fuori copertura"}${searchPolicy === "local-and-online" ? "; Photon online" : ""}`}</Text>
                  {searchWarnings.map((warning, index) => <Notice key={index} text={warning} />)}
                  <Text className="text-xs leading-5 text-[#59667A]">Luoghi da OpenStreetMap e Overture. Le informazioni possono essere incomplete.</Text>
                </Disclosure></View> : null}
              </>
            )}
          </ScrollView>
          {routeView && selected && !journeyStop && !privacy ? <View testID="route-actions" className="border-t border-[#E2E8F0] px-4 pb-3 pt-2">
            <View className="h-12 flex-row items-center gap-2">
              <View className="flex-1">
                <Text numberOfLines={1} accessibilityLiveRegion="polite" className="text-lg font-semibold text-[#17243C]">{originPending || (routing && !route) ? "Calcolo del percorso…" : pickingOrigin ? "Scegli la partenza" : route ? `${duration(route.durationSeconds)} · ${distance(route.distanceMeters)}` : routeError ? "Percorso non disponibile" : "Anteprima del percorso"}</Text>
                <Text numberOfLines={1} className="text-xs text-[#59667A]">{routing && route ? "Aggiornamento…" : routeError && route ? "Aggiornamento non riuscito · percorso precedente" : savedJourneyVisible ? "Viaggio salvato · da aggiornare" : retainedSelection ? "Selezione da aggiornare" : "Pianificazione · senza traffico in tempo reale"}</Text>
              </View>
              <IconButton icon="scan-outline" label="Mostra tutto il percorso" disabled={!route || pickingOrigin} onPress={() => setFrameRevision(value => value + 1)} />
            </View>
            {navigation.supported ? <Button icon="navigate-outline" disabled={!route || !navigation.ready || routing || retainedSelection || pickingOrigin || originPending} onPress={() => {
              if (!route || retainedSelection) return;
              cancelLocationRequest(); suspendTransitWork(); setFollowing(true);
              if (routeMode === "transit") void navigation.startTransit({ plan: route, origin, destination: selected.coordinate });
              else void navigation.start({ destination: selected.coordinate, mode: routeMode });
            }}>{routeMode === "transit" ? "Avvia viaggio" : "Avvia navigazione"}</Button> : <Text className="h-6 text-xs leading-6 text-[#59667A]">Guida disponibile nell’app Android.</Text>}
          </View> : null}
        </View> : null}
      <View className="absolute bottom-0 left-0 right-0 h-16 flex-row border-t border-[#E2E8F0] bg-white px-4">
        {(
          [
            { id: "explore", label: "Mappa", icon: "map-outline" },
            { id: "transit", label: "Trasporti", icon: "bus-outline" },
            { id: "saved", label: "Salvati", icon: "bookmark-outline" },
          ] as const
        ).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item.id }}
            onPress={() => changeTab(item.id)}
            className="h-16 flex-1 items-center justify-center gap-1 py-2"
          >
            <View
              className={`w-16 items-center rounded-full ${tab === item.id ? "bg-[#ECF2FF]" : ""}`}
            >
              <Icon
                name={item.icon}
                size={23}
                color={tab === item.id ? colors.blue : colors.muted}
              />
            </View>
            <Text
              className={`text-xs ${tab === item.id ? "font-semibold text-[#2359D7]" : "text-[#59667A]"}`}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
        </>}
      </View>
    </SafeAreaView>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View className="flex-row items-center justify-center gap-3 py-8">
      <ActivityIndicator color={colors.blue} />
      <Text className="text-sm text-[#59667A]">{label}</Text>
    </View>
  );
}
function PlaceRow({
  place,
  saved,
  onPress,
}: {
  place: Place;
  saved: boolean;
  onPress: () => void;
}) {
  const label = `${place.name} ${place.category ?? ""}`.toLowerCase();
  const icon: IconName = /bar|caff|caf|coffee/.test(label)
    ? "cafe-outline"
    : /shop|nego|cloth|abbigl/.test(label)
      ? "bag-handle-outline"
      : /super|market|spesa/.test(label)
        ? "basket-outline"
        : /food|rist|pizza|burger|mangiare/.test(label)
          ? "restaurant-outline"
          : "location-outline";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="mx-4 min-h-20 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-[#F3F6FA]">
        <Icon name={icon} color={colors.blue} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="flex-shrink text-base font-semibold text-[#17243C]"
            numberOfLines={2}
          >
            {place.name}
          </Text>
          {saved ? (
            <Icon name="bookmark" size={13} color={colors.blue} />
          ) : null}
        </View>
        <Text className="mt-1 text-sm text-[#59667A]" numberOfLines={1}>
          {categoryLabel(place.category)}
          {place.distanceMeters != null
            ? ` · ${distance(place.distanceMeters)}`
            : ""}
        </Text>
        {place.address ? (
          <Text className="mt-1 text-xs text-[#59667A]" numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-16 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
    >
      <Icon name={icon} color={colors.blue} />
      <View className="flex-1">
        <Text className="font-semibold text-[#17243C]">{title}</Text>
        <Text numberOfLines={1} className="mt-1 text-sm text-[#59667A]">
          {subtitle}
        </Text>
      </View>
      <Icon name="open-outline" size={17} color={colors.muted} />
    </Pressable>
  );
}
function PrivacyContent({ onLink }: { onLink: (url: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const icons: IconName[] = [
    "map-outline",
    "location-outline",
    "search-outline",
    "navigate-outline",
    "bus-outline",
    "train-outline",
  ];
  return (
    <View className="gap-3 p-4">
      <Text className="text-base leading-6 text-[#17243C]">
        Nessun account o telemetria. Viaggi, fermate e luoghi salvati restano sul dispositivo.
        Se già autorizzata, la posizione viene aggiornata all’apertura della mappa. Il pulsante posizione permette di richiederla e ricentrare.
      </Text>
      <Text accessibilityRole="header" className="text-lg font-semibold text-[#17243C]">
        Navigazione e posizione
      </Text>
      <Text className="text-sm leading-6 text-[#59667A]">
        Avvia navigazione richiede la posizione precisa e attiva il GPS di Android
        in modo continuo, anche con lo schermo spento finché Android mantiene il
        servizio attivo. La posizione e l’avanzamento sono elaborati sul dispositivo.
        All’avvio e nei ricalcoli stradali, posizione attuale e destinazione vengono
        inviate a FOSSGIS; i ricalcoli automatici sono limitati. Le anteprime possono
        usare una partenza scelta sulla mappa.
      </Text>
      <Text className="text-sm leading-6 text-[#59667A]">
        Una copia locale limitata della sessione permette di mostrare un viaggio
        interrotto e richiede una ripresa esplicita. Interrompi navigazione termina
        posizione continua, voce e richieste e cancella questa copia. Anche l’arrivo
        termina la sessione. La guida vocale usa una voce italiana dichiarata offline
        dal motore del dispositivo; se manca, restano le indicazioni visive.
        La diagnostica locale conserva solo codici di stato, senza posizione o viaggio.
      </Text>
      <Text className="text-sm leading-6 text-[#59667A]">
        Le mappe online comunicano l’area visualizzata a OpenFreeMap. Le
        richieste dirette espongono il tuo indirizzo IP al fornitore. Il
        confine tratteggiato sulla mappa mostra l’estensione del pacchetto
        locale: la presenza di dati non garantisce un elenco completo.
      </Text>
      <DiscoverySettings />
      <DiagnosticsPanel />
      {PROVIDER_NOTICES.map((notice, index) => (
        <View key={notice.name}>
          <ActionRow
            icon={icons[index] ?? "information-circle-outline"}
            title={notice.name}
            subtitle="Informazioni sulla fonte"
            onPress={() => onLink(notice.url)}
          />
          <Text className="mt-2 text-sm leading-5 text-[#59667A]">
            {notice.text}
          </Text>
        </View>
      ))}
      <Notice text="Mappe online, arrivi in tempo reale e calcolo dei percorsi richiedono una connessione. Puoi riaprire la copia di un viaggio salvato senza connessione; i suoi orari sono da aggiornare. La disponibilità dei servizi pubblici può variare." />
      <NavigationNotices onLink={onLink} />
      <Text className="mt-2 text-lg font-semibold text-[#17243C]">
        Licenze dei dati
      </Text>
      {DATA_LICENSES.map((license) => (
        <View key={license.id} className="border-b border-[#E2E8F0] pb-3">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: expanded === license.id }}
            onPress={() =>
              setExpanded(expanded === license.id ? null : license.id)
            }
            className="min-h-12 flex-row items-center justify-between"
          >
            <Text className="flex-1 font-semibold text-[#17243C]">
              {license.id}
            </Text>
            <Icon
              name={expanded === license.id ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </Pressable>
          {expanded === license.id ? (
            <Text selectable className="text-xs leading-5 text-[#59667A]">
              {license.text}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MapsApp />
    </SafeAreaProvider>
  );
}
