import "./global.css";
import type { LineString } from "geojson";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import MapCanvas from "./src/components/MapCanvas";
import { displayedDepartureStatus } from "./src/components/departure-status";
import type { MapMarker } from "./src/components/MapCanvas.types";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Notice,
  type IconName,
} from "./src/components/Controls";
import { colors } from "./src/theme/tokens";
import type {
  Coordinate,
  Departure,
  DepartureBoard,
  Place,
  Stop,
  TransitAlert,
  TransitTime,
  TravelMode,
} from "./src/domain/types";
import {
  getDepartures,
  getNearbyStops,
  getTransitAlerts,
  loadSavedPlaces,
  removeSavedPlace,
  savePlace,
  searchPlaces,
  searchLocalPlaces,
  categoryLabel,
  DATA_LICENSES,
  PROVIDER_NOTICES,
} from "./src/services";
import { getCurrentLocation } from "./src/platform/location";
import { DiagnosticsPanel } from "./src/components/DiagnosticsPanel";
import { JourneyResults, TransitTimeForm } from "./src/components/JourneyPlanner";
import { useRoutePlans } from "./src/components/useRoutePlans";

const DOCKS: Coordinate = { latitude: 45.0937, longitude: 7.6832 };
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
const time = (value: number) =>
  new Date(value).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
const categories: { label: string; query: string; icon: IconName }[] = [
  { label: "Mangiare", query: "ristoranti", icon: "restaurant-outline" },
  { label: "Caffè e bar", query: "bar", icon: "cafe-outline" },
  { label: "Spesa", query: "supermercato", icon: "basket-outline" },
  { label: "Negozi", query: "negozi", icon: "bag-handle-outline" },
];
const modes: { id: TravelMode; label: string; icon: IconName }[] = [
  { id: "walk", label: "A piedi", icon: "walk-outline" },
  { id: "bicycle", label: "Bici", icon: "bicycle-outline" },
  { id: "car", label: "Auto", icon: "car-outline" },
  { id: "transit", label: "Mezzi", icon: "bus-outline" },
];

function MapsApp() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 850;
  const [tab, setTab] = useState<"explore" | "transit" | "saved">("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ristoranti");
  const [center, setCenter] = useState(DOCKS);
  const viewport = useRef(DOCKS);
  const locationRequest = useRef(0);
  const [searchCenter, setSearchCenter] = useState(DOCKS);
  const [areaChanged, setAreaChanged] = useState(false);
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [retrySearch, setRetrySearch] = useState(0);
  const [saved, setSaved] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [listOnly, setListOnly] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [routeMode, setRouteMode] = useState<TravelMode>("walk");
  const [originPending, setOriginPending] = useState(false);
  const [routeView, setRouteView] = useState(false);
  const [transitTime, setTransitTime] = useState<TransitTime>({ kind: "now" });
  const [origin, setOrigin] = useState<Coordinate>(DOCKS);
  const [originLabel, setOriginLabel] = useState("Centro della mappa");
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const { route, plans: routePlans, error: routeError, loading: routing, refresh: refreshRoutes, select: selectRoute, reset: resetRoutes } = useRoutePlans({
    from: origin,
    to: selected?.coordinate,
    mode: routeMode,
    transitTime,
    enabled: routeView && !pickingOrigin && !originPending,
  });
  const [stop, setStop] = useState<Stop | null>(null);
  const [board, setBoard] = useState<DepartureBoard | null>(null);
  const [alerts, setAlerts] = useState<TransitAlert[]>([]);
  const [transitLoading, setTransitLoading] = useState(false);
  const [transitError, setTransitError] = useState("");
  const [alertsError, setAlertsError] = useState("");
  const [refreshBoard, setRefreshBoard] = useState(0);
  const [now, setNow] = useState(Date.now());
  const stops = useMemo(
    () => getNearbyStops(searchCenter, { limit: 15, radiusMeters: 1800 }),
    [searchCenter],
  );
  const shownPlaces = tab === "saved" ? saved : results;
  const cancelLocationRequest = useCallback(() => {
    locationRequest.current += 1;
    setOriginPending(false);
    setLocating(false);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (pickingOrigin) {
          setPickingOrigin(false);
          return true;
        }
        if (privacy) {
          setPrivacy(false);
          return true;
        }
        if (routeView) {
          cancelLocationRequest();
          setRouteView(false);
          resetRoutes();
          return true;
        }
        if (selected || stop) {
          setSelected(null);
          setStop(null);
          return true;
        }
        if (listOnly) {
          setListOnly(false);
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
  }, [pickingOrigin, privacy, routeView, selected, stop, listOnly, tab, cancelLocationRequest, resetRoutes]);
  useEffect(() => {
    loadSavedPlaces()
      .then(setSaved)
      .catch(() =>
        setLocationMessage(
          "Impossibile leggere i luoghi salvati su questo dispositivo.",
        ),
      );
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tab !== "explore") return;
    const controller = new AbortController();
    setSearching(true);
    setSearchError("");
    setSearchWarnings([]);
    setResults(searchLocalPlaces(query.trim() || category, searchCenter));
    const timer = setTimeout(
      () => {
        searchPlaces(query.trim() || category, {
          center: searchCenter,
          signal: controller.signal,
        })
          .then((result) => {
            if (!controller.signal.aborted) {
              setResults(result.places);
              setSearchWarnings(result.warnings);
            }
          })
          .catch((error) => {
            if (!controller.signal.aborted) {
              setSearchError(
                error instanceof Error
                  ? error.message
                  : "Ricerca non disponibile.",
              );
              setResults([]);
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
    };
  }, [query, category, searchCenter, retrySearch, tab]);


  useEffect(() => {
    if (!stop) return;
    const controller = new AbortController();
    setTransitLoading(true);
    setTransitError("");
    setAlertsError("");
    setBoard(null);
    setAlerts([]);
    getDepartures(stop.id, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setBoard(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setTransitError(
            error instanceof Error ? error.message : "Arrivi non disponibili.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTransitLoading(false);
      });
    getTransitAlerts(stop.id, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setAlerts(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setAlertsError(
            "Avvisi di servizio non disponibili.",
          );
      });
    return () => controller.abort();
  }, [stop, refreshBoard]);

  async function locate() {
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationMessage("");
    try {
      const position = await getCurrentLocation();
      if (request !== locationRequest.current) return;
      const next = point(position.coordinate);
      setLocation(next);
      setCenter(next);
      viewport.current = next;
      setSearchCenter(next);
      setAreaChanged(false);
      if (routeView) {
        setOrigin(next);
        setOriginLabel("La tua posizione");
        setPickingOrigin(false);
      }
    } catch (error) {
      if (request !== locationRequest.current) return;
      setLocationMessage(
        error instanceof Error
          ? error.message
          : "Posizione non disponibile. Puoi continuare a esplorare la mappa.",
      );
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  }
  function openPlace(place: Place) {
    cancelLocationRequest();
    Keyboard.dismiss();
    setSelected(place);
    setRouteView(false);
    resetRoutes();
    setCenter(place.coordinate);
    setListOnly(false);
    setStop(null);
  }
  function changeTab(next: typeof tab) {
    cancelLocationRequest();
    Keyboard.dismiss();
    setTab(next);
    setSelected(null);
    setStop(null);
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
      setLocationMessage("Salvataggio non riuscito. Riprova.");
    }
  }
  function searchArea() {
    cancelLocationRequest();
    setSearchCenter(viewport.current);
    setAreaChanged(false);
    setSelected(null);
    setStop(null);
    setRouteView(false);
    resetRoutes();
  }
  async function beginRoute(destination?: Place) {
    if (destination) openPlace(destination);
    const request = ++locationRequest.current;
    resetRoutes();
    setOrigin(searchCenter);
    setOriginLabel("Centro dell’area esplorata");
    setRouteView(true);
    if (!location) return;
    setOriginPending(true);
    setLocating(true);
    try {
      const fresh = await getCurrentLocation();
      if (request !== locationRequest.current) return;
      const next = point(fresh.coordinate);
      setLocation(next);
      setOrigin(next);
      setOriginLabel("La tua posizione");
    } catch {
      if (request !== locationRequest.current) return;
      setLocationMessage(
        "Posizione non aggiornata. Il percorso parte dal centro dell’area esplorata: puoi scegliere un altro punto sulla mappa.",
      );
    } finally {
      if (request === locationRequest.current) {
        setOriginPending(false);
        setLocating(false);
      }
    }
  }
  async function openLink(url: string) {
    if (!/^(https?:|tel:)/i.test(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      setLocationMessage("Impossibile aprire questo collegamento.");
    }
  }
  const onMapPress = (coordinate: [number, number]) => {
    if (pickingOrigin) {
      cancelLocationRequest();
      setOrigin(point(coordinate));
      setOriginLabel("Punto scelto sulla mappa");
      setPickingOrigin(false);
    }
  };
  const title = privacy
    ? "Privacy e fonti"
    : routeView
      ? "Il tuo percorso"
      : selected
        ? selected.name
        : stop
          ? stop.name
          : tab === "transit"
            ? "Muoviti a Torino"
            : tab === "saved"
              ? "I tuoi luoghi"
              : query.trim()
                ? `Risultati per “${query.trim()}”`
                : category === "ristoranti"
                  ? "Dove mangiare"
                  : category === "bar"
                    ? "Una pausa in zona"
                    : category === "supermercato"
                      ? "La spesa, qui vicino"
                      : "Negozi da scoprire";
  const isSaved = selected
    ? saved.some((item) => item.id === selected.id)
    : false;
  const routeGeometry = useMemo<LineString | null>(
    () =>
      route && route.geometry.length > 1
        ? { type: "LineString", coordinates: route.geometry.map(tuple) }
        : null,
    [route],
  );
  const mapMarkers = useMemo(() => {
    const markers: MapMarker[] =
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

    return markers;
  }, [tab, stops, shownPlaces, selected]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View className="border-b border-[#E2E8F0] bg-white px-4 pb-3 pt-2">
        <View className="flex-row items-center gap-3">
          {wide ? (
            <View className="mr-3 flex-row items-center gap-2">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#2359D7]">
                <Icon name="navigate" color="white" />
              </View>
              <Text className="text-xl font-bold text-[#17243C]">Maps</Text>
            </View>
          ) : null}
          <View className="min-h-12 min-w-0 flex-1 flex-row items-center rounded-2xl bg-[#F3F6FA] pl-4 pr-1">
            <Icon name="search-outline" color={colors.muted} size={21} />
            <TextInput
              accessibilityLabel="Cerca luoghi, indirizzi o attività"
              className="min-h-12 min-w-0 flex-1 px-3 text-base text-[#17243C]"
              placeholder="Dove vuoi andare?"
              placeholderTextColor={colors.muted}
              value={query}
              returnKeyType="search"
              autoCorrect={false}
              onChangeText={(value) => {
                cancelLocationRequest();
                setQuery(value);
                setTab("explore");
                setSelected(null);
                setStop(null);
                setRouteView(false);
                resetRoutes();
                setPrivacy(false);
              }}
              onSubmitEditing={() => {
                Keyboard.dismiss();
                setRetrySearch((value) => value + 1);
              }}
            />
            {query ? (
              <IconButton
                icon="close"
                label="Cancella ricerca"
                onPress={() => setQuery("")}
              />
            ) : (
              <IconButton
                icon="options-outline"
                label="Privacy e fonti"
                active={privacy}
                onPress={() => setPrivacy((value) => !value)}
              />
            )}
          </View>
          {!wide ? null : (
            <Text className="ml-3 text-sm text-[#59667A]">
              Torino, a modo tuo
            </Text>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ gap: 8 }}
        >
          {categories.map((item) => (
            <Pressable
              key={item.query}
              accessibilityRole="button"
              accessibilityState={{
                selected:
                  category === item.query && !query && tab === "explore",
              }}
              onPress={() => {
                changeTab("explore");
                setCategory(item.query);
                setQuery("");
              }}
              className={`min-h-11 flex-row items-center gap-2 rounded-full px-4 ${category === item.query && !query && tab === "explore" ? "bg-[#17243C]" : "bg-[#F3F6FA]"}`}
            >
              <Icon
                name={item.icon}
                size={17}
                color={
                  category === item.query && !query && tab === "explore"
                    ? "white"
                    : colors.ink
                }
              />
              <Text
                className={`text-sm font-medium ${category === item.query && !query && tab === "explore" ? "text-white" : "text-[#17243C]"}`}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={{ flex: 1, flexDirection: wide ? "row-reverse" : "column" }}>
        {!listOnly || wide ? (
          <View
            style={{
              flex: wide ? 1 : undefined,
              height: wide
                ? undefined
                : Math.max(
                    180,
                    Math.min(
                      height *
                        (selected || stop || routeView || privacy
                          ? 0.29
                          : 0.36),
                      380,
                    ),
                  ),
              backgroundColor: "#DFE8EB",
            }}
          >
            <MapCanvas
              center={tuple(center)}
              markers={mapMarkers}
              selectedMarkerId={selected?.id ?? stop?.id}
              userLocation={location ? tuple(location) : null}
              route={routeGeometry}
              zoom={15}
              onMapPress={onMapPress}
              onRegionChanged={(coordinate) => {
                viewport.current = point(coordinate);
                if (
                  Math.abs(coordinate[0] - searchCenter.longitude) +
                    Math.abs(coordinate[1] - searchCenter.latitude) >
                  0.004
                )
                  setAreaChanged(true);
              }}
              onPressMarker={(id) => {
                if (pickingOrigin) {
                  const marker = mapMarkers.find((item) => item.id === id);
                  if (marker) onMapPress(marker.coordinate);
                  return;
                }
                if (tab === "transit") {
                  const next = stops.find((item) => item.id === id);
                  if (next) {
                    setStop(next);
                    setCenter(next.coordinate);
                  }
                } else {
                  const next = shownPlaces.find((item) => item.id === id);
                  if (next) openPlace(next);
                }
              }}
            />
            <View
              pointerEvents="box-none"
              className="absolute left-3 right-3 top-3 flex-row items-start justify-between"
            >
              <View
                className="max-w-[75%] rounded-xl bg-white px-3 py-2"
                style={{ elevation: 2, boxShadow: "0 2px 8px #17243c12" }}
              >
                <View className="flex-row items-center gap-1.5">
                  <Icon
                    name={location ? "locate-outline" : "map-outline"}
                    size={14}
                    color={colors.blue}
                  />
                  <Text className="text-xs font-semibold text-[#17243C]">
                    {Math.abs(searchCenter.latitude - DOCKS.latitude) +
                      Math.abs(searchCenter.longitude - DOCKS.longitude) <
                    0.003
                      ? "Docks Dora e dintorni"
                      : "Area della mappa"}
                  </Text>
                </View>
                {!location ? (
                  <Text className="mt-0.5 text-[11px] text-[#59667A]">
                    Esplorazione manuale · GPS non attivo
                  </Text>
                ) : null}
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
            {pickingOrigin ? (
              <View className="absolute bottom-10 left-4 right-4">
                <Notice
                  text="Tocca la mappa per scegliere il punto di partenza."
                  action="Annulla"
                  onAction={() => setPickingOrigin(false)}
                />
              </View>
            ) : areaChanged && !selected && !stop ? (
              <View className="absolute bottom-10 self-center">
                <Button icon="search-outline" secondary onPress={searchArea}>
                  Cerca in quest’area
                </Button>
              </View>
            ) : null}
          </View>
        ) : null}

        <View
          style={{
            flex: wide ? undefined : 1,
            width: wide ? 410 : undefined,
            borderRightWidth: wide ? 1 : 0,
            borderColor: colors.line,
          }}
          className="bg-white"
        >
          <View className="border-b border-[#E2E8F0] px-5 pb-3 pt-4">
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1">
                {selected || stop || privacy ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (routeView) {
                        cancelLocationRequest();
                        setRouteView(false);
                        resetRoutes();
                        setPickingOrigin(false);
                      } else {
                        setSelected(null);
                        setStop(null);
                        setPrivacy(false);
                      }
                    }}
                    className="mb-1 min-h-9 flex-row items-center gap-1"
                  >
                    <Icon name="arrow-back" size={17} color={colors.blue} />
                    <Text className="text-sm font-semibold text-[#2359D7]">
                      {routeView ? "Luogo" : "Esplora"}
                    </Text>
                  </Pressable>
                ) : null}
                <Text
                  className="text-[23px] font-bold leading-7 text-[#17243C]"
                  numberOfLines={2}
                >
                  {title}
                </Text>
                {!selected && !stop && !privacy ? (
                  <Text className="mt-1 text-sm text-[#59667A]">
                    {tab === "saved"
                      ? "Sempre qui, solo sul tuo dispositivo"
                      : tab === "transit"
                        ? "Fermate nell’area della mappa"
                        : `${shownPlaces.length} luoghi nell’area della mappa`}
                  </Text>
                ) : null}
              </View>
              {!wide && !selected && !stop && !privacy ? (
                <IconButton
                  icon={listOnly ? "map-outline" : "list-outline"}
                  label={listOnly ? "Mostra mappa" : "Espandi elenco"}
                  active={listOnly}
                  onPress={() => setListOnly((value) => !value)}
                />
              ) : null}
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {locationMessage ? (
              <View className="mx-5 mt-3">
                <Notice
                  text={locationMessage}
                  action="Chiudi"
                  onAction={() => setLocationMessage("")}
                />
              </View>
            ) : null}
            {privacy ? (
              <PrivacyContent onLink={openLink} />
            ) : routeView && selected ? (
              <View className="gap-4 p-5">
                <View className="rounded-2xl bg-[#F3F6FA] p-4">
                  <Text className="text-xs text-[#59667A]">Da</Text>
                  <Text className="mt-1 font-semibold text-[#17243C]">
                    {originLabel}
                  </Text>
                  <Text className="mt-3 text-xs text-[#59667A]">A</Text>
                  <Text className="mt-1 font-semibold text-[#17243C]">
                    {selected.name}
                  </Text>
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Button
                      secondary
                      icon="locate-outline"
                      loading={locating}
                      onPress={locate}
                    >
                      Posizione
                    </Button>
                  </View>
                  <View className="flex-1">
                    <Button
                      secondary
                      icon="map-outline"
                      onPress={() => {
                        cancelLocationRequest();
                        setPickingOrigin(true);
                        setListOnly(false);
                      }}
                    >
                      Scegli
                    </Button>
                  </View>
                </View>
                <View className="flex-row rounded-2xl bg-[#F3F6FA] p-1">
                  {modes.map((mode) => (
                    <Pressable
                      key={mode.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: routeMode === mode.id }}
                      onPress={() => setRouteMode(mode.id)}
                      className={`min-h-16 flex-1 items-center justify-center gap-1 rounded-xl ${routeMode === mode.id ? "bg-white" : ""}`}
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
                    value={transitTime}
                    disabled={routing || originPending || pickingOrigin}
                    onSubmit={(value) => { setTransitTime(value); refreshRoutes(); }}
                  />
                ) : null}
                {pickingOrigin ? (
                  <Notice text="Scegli la partenza sulla mappa per calcolare il percorso." />
                ) : routeMode === "transit" && route ? (
                  <JourneyResults
                    plans={routePlans}
                    selected={route}
                    onSelect={selectRoute}
                    onRefresh={refreshRoutes}
                    loading={routing}
                    error={routeError}
                    now={now}
                    query={transitTime}
                  />
                ) : routing || originPending ? (
                  <Loading label="Calcolo del percorso…" />
                ) : routeError ? (
                  <Notice
                    danger
                    text={routeError}
                    action="Riprova"
                    onAction={refreshRoutes}
                  />
                ) : route ? (
                  <>
                    <View className="flex-row items-baseline gap-3">
                      <Text className="text-3xl font-bold text-[#2359D7]">
                        {duration(route.durationSeconds)}
                      </Text>
                      <Text className="text-base text-[#59667A]">
                        {distance(route.distanceMeters)}
                      </Text>
                    </View>
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
                      Percorso: {route.source}. Dati © OpenStreetMap
                      contributors.
                    </Text>
                  </>
                ) : null}
              </View>
            ) : selected ? (
              <View className="gap-4 p-5">
                <View>
                  <Text className="text-base text-[#59667A]">
                    {categoryLabel(selected.category)}
                    {selected.distanceMeters != null
                      ? ` · ${distance(selected.distanceMeters)}`
                      : ""}
                  </Text>
                  {selected.address ? (
                    <Text className="mt-2 text-base leading-6 text-[#17243C]">
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
                <Notice text="Orari di apertura non disponibili." />
                <Text className="text-xs leading-5 text-[#59667A]">
                  Fonte: {selected.source}
                  {selected.dataUpdatedAt
                    ? `\nDati del ${selected.dataUpdatedAt}`
                    : ""}
                  {selected.attributions.length
                    ? `\n${selected.attributions.join("\n")}`
                    : ""}
                </Text>
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
            ) : stop ? (
              <View className="gap-4 p-5">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-sm text-[#59667A]">
                    Fermata {stop.code}
                    {stop.distanceMeters
                      ? ` · ${distance(stop.distanceMeters)}`
                      : ""}
                  </Text>
                  <IconButton
                    icon="refresh-outline"
                    label="Aggiorna arrivi"
                    disabled={transitLoading}
                    onPress={() => setRefreshBoard((value) => value + 1)}
                  />
                </View>
                {transitLoading ? (
                  <Loading label="Cerco i prossimi arrivi…" />
                ) : transitError ? (
                  <Notice
                    danger
                    text={transitError}
                    action="Riprova"
                    onAction={() => setRefreshBoard((value) => value + 1)}
                  />
                ) : board ? (
                  <>
                    <View className="flex-row items-center gap-2">
                      <View
                        className={`h-2 w-2 rounded-full ${now - board.fetchedAt < 120000 ? "bg-[#167469]" : "bg-[#9A5800]"}`}
                      />
                      <Text className="text-xs text-[#59667A]">
                        Consultato alle {time(board.fetchedAt)} · {board.source}
                      </Text>
                    </View>
                    {board.warnings.map((warning, index) => (
                      <Notice key={index} text={warning} />
                    ))}
                    {board.departures.length ? (
                      board.departures.map((departure) => (
                        <DepartureRow
                          key={departure.id}
                          departure={departure}
                          now={now}
                          feedUpdatedAt={board.sourceUpdatedAt}
                        />
                      ))
                    ) : (
                      <EmptyState
                        icon="time-outline"
                        title="Nessun arrivo disponibile"
                        description="La fonte non riporta partenze per questa fermata. Riprova tra poco o scegli una fermata vicina."
                      />
                    )}
                  </>
                ) : null}
                {alertsError ? <Notice text={alertsError} /> : null}
                {alerts.map((alert) => (
                  <View key={alert.id} className="rounded-2xl bg-[#FFF5DE] p-4">
                    <Text className="font-semibold text-[#17243C]">
                      {alert.title}
                    </Text>
                    <Text className="mt-2 text-sm leading-5 text-[#59667A]">
                      {alert.description}
                    </Text>
                    {alert.url ? (
                      <Pressable
                        accessibilityRole="link"
                        className="min-h-11 justify-center"
                        onPress={() => openLink(alert.url!)}
                      >
                        <Text className="font-semibold text-[#2359D7]">
                          Dettagli avviso
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Button
                  secondary
                  icon="walk-outline"
                  onPress={() => {
                    const next: Place = {
                      id: `stop:${stop.id}`,
                      name: `Fermata ${stop.name}`,
                      coordinate: stop.coordinate,
                      category: "Fermata GTT",
                      source: "GTT",
                      attributions: ["Dati GTT"],
                    };
                    setRouteMode("walk");
                    beginRoute(next);
                  }}
                >
                  Raggiungi la fermata
                </Button>
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
                        setStop(item);
                        setCenter(item.coordinate);
                        setListOnly(false);
                      }}
                      className="mx-5 min-h-20 flex-row items-center gap-3 border-b border-[#E2E8F0] py-4"
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
            ) : (
              <>
                {searching && tab === "explore" ? (
                  <View className="flex-row items-center gap-2 px-5 pt-3">
                    <ActivityIndicator size="small" color={colors.blue} />
                    <Text className="text-xs text-[#59667A]">
                      Aggiorno i risultati…
                    </Text>
                  </View>
                ) : null}
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
                        : "Nessun luogo trovato"
                    }
                    description={
                      tab === "saved"
                        ? "Apri un luogo e tocca Salva. Lo ritrovi qui, senza account."
                        : "Prova un nome, una categoria diversa o sposta la mappa per ampliare la ricerca."
                    }
                  />
                )}
                {!searching && tab === "explore" && searchWarnings.length ? (
                  <View className="mx-5 mt-4 gap-2">
                    {searchWarnings.map((warning, index) => (
                      <Notice key={index} text={warning} />
                    ))}
                  </View>
                ) : null}
                {tab === "explore" && !searching ? (
                  <Text className="px-5 pt-4 text-xs leading-5 text-[#59667A]">
                    Luoghi da OpenStreetMap e Overture. Le informazioni possono
                    essere incomplete.
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <View className="min-h-16 flex-row border-t border-[#E2E8F0] bg-white px-4">
        {(
          [
            { id: "explore", label: "Esplora", icon: "compass-outline" },
            { id: "transit", label: "Trasporti", icon: "bus-outline" },
            { id: "saved", label: "Salvati", icon: "bookmark-outline" },
          ] as const
        ).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item.id }}
            onPress={() => changeTab(item.id)}
            className="min-h-16 flex-1 items-center justify-center gap-1 py-2"
          >
            <View
              className={`w-16 items-center rounded-full py-1 ${tab === item.id ? "bg-[#ECF2FF]" : ""}`}
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
      className="mx-5 min-h-24 flex-row items-center gap-3 border-b border-[#E2E8F0] py-4"
    >
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#F0F4FB]">
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
function DepartureRow({
  departure,
  now,
  feedUpdatedAt,
}: {
  departure: Departure;
  now: number;
  feedUpdatedAt?: number;
}) {
  const at = departure.expectedAt ?? departure.scheduledAt;
  const status = displayedDepartureStatus(departure, feedUpdatedAt, now);
  const labels = {
    live: "Tempo reale",
    scheduled: "Da orario",
    stale: "Dato non aggiornato",
    cancelled: "Corsa cancellata",
    unknown: "Orario non disponibile",
  };
  return (
    <View className="flex-row items-center gap-3 border-b border-[#E2E8F0] py-3">
      <View className="min-w-12 items-center rounded-xl bg-[#17243C] px-2 py-3">
        <Text className="font-bold text-white">{departure.line}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-semibold leading-5 text-[#17243C]">
          {departure.headsign || "Direzione non indicata"}
        </Text>
        <Text
          className={`mt-1 text-xs ${status === "live" ? "text-[#167469]" : "text-[#59667A]"}`}
        >
          {labels[status]}
        </Text>
      </View>
      <Text
        className={`text-lg font-bold ${status === "live" ? "text-[#167469]" : "text-[#59667A]"}`}
      >
        {status === "cancelled"
          ? "—"
          : at
            ? status === "live" && at >= now
              ? `${Math.max(0, Math.ceil((at - now) / 60000))} min`
              : time(at)
            : "—"}
      </Text>
    </View>
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
    <View className="gap-4 p-5">
      <Text className="text-base leading-6 text-[#17243C]">
        Nessun account. I luoghi salvati restano sul dispositivo. La posizione
        si attiva quando la richiedi.
      </Text>
      <Text className="text-sm leading-6 text-[#59667A]">
        Le mappe online comunicano l’area visualizzata a OpenFreeMap. Le
        richieste dirette espongono il tuo indirizzo IP al fornitore. Il
        pacchetto locale dei luoghi copre Docks Dora e una parte di Barriera di
        Milano.
      </Text>
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
      <Notice text="Mappe online, arrivi in tempo reale e percorsi richiedono una connessione. La disponibilità dei servizi pubblici può variare." />
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
