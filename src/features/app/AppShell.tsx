import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "../../ui/Text";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "../../theme";
import { Button, Icon, IconButton, Notice, useHairlines } from "../../ui";
import { formatDistance } from "../../ui/format";
import { mapCameraPadding } from "../map/map-presentation";
import { useMapContext } from "../map/useMapModel";
import { NavigationPanel } from "../navigation/NavigationPanel";
import { TransitFollowPanel } from "../navigation/TransitFollowPanel";
import { useNavigationContext } from "../navigation/useNavigation";
import { usePlannerContext } from "../planner/usePlanner";
import { SearchField } from "../search/SearchField";
import { useSearchContext } from "../search/useSearch";
import { useTransitContext } from "../transit/useTransit";
import { AppMap } from "./AppMap";
import { useFeedback } from "./feedback";
import { useSheet } from "./sheet";
import { defaultSnap, peekContentHeight, resolveSnap, sheetHeights } from "./sheet-model";
import { rootTab, selectedPlace, selectedStop, sheetVisible } from "./task-model";
import { TaskSheet } from "./TaskSheet";
import { useNow } from "./useNow";
import { useShellActions } from "./useShellActions";
import { useTaskState } from "./useTaskModel";

const ROOT_SHORTCUTS = [
  { id: "transit", label: "Trasporti", icon: "bus-outline" },
  { id: "saved", label: "Salvati", icon: "bookmark-outline" },
] as const;
const SIDE_SHEET_WIDTH = 434;

/** Screen layout: one map, the search bar, map controls, and one task sheet or guidance. */
export function AppShell() {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Android resizes the window for the keyboard; the geographic viewport stays put.
  const mapWindow = useRef({ width, height });
  if (width !== mapWindow.current.width || height > mapWindow.current.height) mapWindow.current = { width, height };
  const mapHeight = mapWindow.current.height - insets.top - insets.bottom;
  const availableHeight = height - insets.top - insets.bottom;
  const wide = width >= 850;
  const now = useNow();
  const tasks = useTaskState();
  const sheet = useSheet();
  const search = useSearchContext();
  const navigation = useNavigationContext();
  const { camera, location, locate, searchArea } = useMapContext();
  const feedback = useFeedback();
  const shell = useShellActions();
  const planner = usePlannerContext();
  const transit = useTransitContext();
  const tab = rootTab(tasks);
  const panelVisible = sheetVisible(tasks);
  const heights = sheetHeights({ availableHeight, fontScale, peekContent: peekContentHeight(tasks, search.hasSearch) });
  const resting = defaultSnap(tasks, search.hasSearch);
  const snap = resolveSnap(sheet.requested, resting);
  const sheetHeightsRef = sheet.heights;
  useLayoutEffect(() => { sheetHeightsRef.current = heights; });
  // The camera padding follows the sheet's target height, so pins and routes stay in the visible map.
  const currentSheetHeight = heights[snap];
  const mapPadding = mapCameraPadding({ width, height: mapHeight, sheetHeight: currentSheetHeight + 8, panelVisible, navigating: navigation.visible, fontScale });
  const message = location.message || feedback.message;
  const dismissMessage = () => location.message ? location.setMessage("") : feedback.dismiss();
  // Measured guidance chrome: the camera places the puck inside the map left between them.
  const [guidanceChrome, setGuidanceChrome] = useState({ top: 120, bottom: 190 });
  const guidanceViewport = useMemo(() => ({ width, height: mapHeight, top: Math.min(guidanceChrome.top, mapHeight - 160), bottom: Math.max(Math.min(guidanceChrome.top, mapHeight - 160) + 120, mapHeight - guidanceChrome.bottom) }),
    [width, mapHeight, guidanceChrome]);
  const onGuidanceChrome = (top: number, bottom: number) => setGuidanceChrome(current => Math.abs(current.top - top) < 1 && Math.abs(current.bottom - bottom) < 1 ? current : { top, bottom });
  const overlayPosition = { bottom: !wide && panelVisible ? currentSheetHeight + 24 : 88, left: wide && panelVisible ? SIDE_SHEET_WIDTH + 8 : 16, right: 16 };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.chrome }} edges={["top", "bottom"]}>
      <View className="flex-1">
        <AppMap
          height={mapHeight}
          padding={mapPadding}
          attributionLeft={wide && panelVisible && !navigation.visible ? SIDE_SHEET_WIDTH - 4 : 8}
          attributionTop={navigation.visible ? guidanceViewport.top + 8 : 68}
          guidanceViewport={guidanceViewport}
        />
        {navigation.visible && (navigation.snapshot.mode === "transit" || (navigation.busy === "start" && navigation.startKind === "transit")) ? (
          <TransitFollowPanel state={navigation} following={camera.following} follow={transit.follow} onRecenter={camera.recenterGuidance} onChromeLayout={onGuidanceChrome}
            onStop={() => { void navigation.stop(); }} onRetry={() => { void navigation.retry(); }}
            onConfirm={action => { void navigation.confirmTransit(action); }} onReplan={() => { void planner.replanFromNavigation(); }}
            onMute={() => { void navigation.toggleMuted(); }} />
        ) : navigation.visible ? (
          <NavigationPanel {...navigation} following={camera.following} intent={camera.guidanceIntent} onRecenter={camera.recenterGuidance}
            onOverview={camera.overviewGuidance} onChromeLayout={onGuidanceChrome}
            onStop={() => { void navigation.stop(); }} onRetry={() => { void navigation.retry(); }} onMute={() => { void navigation.toggleMuted(); }}
            onConfirmTransit={action => { void navigation.confirmTransit(action); }} onReplan={() => { void planner.replanFromNavigation(); }} />
        ) : <>
          {/* Status chips start after the attribution control (top 68, left 8, 44 px), which must stay reachable. */}
          <View pointerEvents="box-none" style={{ left: 64 }} className="absolute right-3 top-20 flex-row items-start justify-between">
            <View className="flex-1" pointerEvents="none">
              {location.locating ? <Text accessibilityLiveRegion="polite" style={hairlines.floating} className="self-start overflow-hidden rounded-full px-3 py-2 text-sm text-secondary">Ricerca della posizione…</Text>
                : !location.coordinate && camera.view === "overview" && !panelVisible ? <Text accessibilityLabel="Vista panoramica di Torino, non la tua posizione" style={hairlines.floating} className="self-start overflow-hidden rounded-full px-3 py-2 text-sm text-secondary">Panoramica di Torino</Text>
                  : null}
            </View>
            {location.locating ? (
              <View style={hairlines.floating} accessible accessibilityLabel="Ricerca della posizione in corso" className="h-12 w-12 items-center justify-center rounded-full">
                <ActivityIndicator color={colors.action} />
              </View>
            ) : <IconButton floating icon="locate-outline" label="Usa la mia posizione" onPress={locate} />}
          </View>
          {message ? <View style={overlayPosition} className="absolute"><Notice tone="caution" text={message} action="Chiudi" onAction={dismissMessage} /></View> : null}
          {camera.areaChanged && (search.hasSearch || tab === "transit") && !selectedPlace(tasks) && !selectedStop(tasks) ? (
            <View style={[overlayPosition, hairlines.floating]} className="absolute max-w-[95%] items-center self-center rounded-2xl">
              <Button icon="search-outline" variant="secondary" onPress={searchArea}>Cerca in quest’area</Button>
              <Text className="px-3 pb-2 text-center text-sm text-secondary">{tab === "transit" ? "Fermate intorno al centro" : search.result.coverage.radiusMeters !== null ? `Raggio ${formatDistance(search.result.coverage.radiusMeters)} dal centro` : search.policy === "local-only" ? "Nomi nell’intero pacchetto locale" : "Nomi nel pacchetto; area come riferimento online"}</Text>
            </View>
          ) : null}
          <View className="absolute left-0 right-0 top-0 px-3 py-2">
            <View className="flex-row items-center gap-2">
              <SearchField />
              <IconButton floating icon="options-outline" label="Privacy e fonti" active={tasks.settings} onPress={shell.toggleSettings} />
            </View>
          </View>
          {panelVisible ? (
            // The sheet library sizes its content to the highest snap, so at peek and half the lower part
            // sits below the visible sheet. Clip at this container, which ends above the navigation bar
            // (SafeAreaView bottom edge), so content never draws under the system buttons.
            <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, wide ? { right: undefined, width: SIDE_SHEET_WIDTH } : null]}>
              <TaskSheet snap={snap} resting={resting} heights={heights} now={now} />
            </View>
          ) : (
            <View pointerEvents="box-none" style={{ position: "absolute", bottom: 12, left: 12, right: 12 }} className="flex-row justify-center gap-2">
              {ROOT_SHORTCUTS.map(item => (
                <Pressable key={item.id} accessibilityRole="button" onPress={() => shell.openTab(item.id)} style={hairlines.floating}
                  className="min-h-12 flex-row items-center justify-center gap-2 rounded-full px-5">
                  <Icon name={item.icon} size={22} color={colors.textPrimary} />
                  <Text className="text-base font-medium text-primary">{item.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>}
      </View>
    </SafeAreaView>
  );
}
