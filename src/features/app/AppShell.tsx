import { useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "../../theme";
import { Button, Icon, IconButton, Notice } from "../../ui";
import { formatDistance } from "../../ui/format";
import { mapCameraPadding } from "../map/map-presentation";
import { useMapContext } from "../map/useMapModel";
import { NavigationPanel } from "../navigation/NavigationPanel";
import { useNavigationContext } from "../navigation/useNavigation";
import { usePlannerContext } from "../planner/usePlanner";
import { SearchField } from "../search/SearchField";
import { useSearchContext } from "../search/useSearch";
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
  const tab = rootTab(tasks);
  const panelVisible = sheetVisible(tasks);
  const heights = sheetHeights({ availableHeight, fontScale, peekContent: peekContentHeight(tasks, search.hasSearch) });
  const resting = defaultSnap(tasks, search.hasSearch);
  const snap = resolveSnap(sheet.requested, resting);
  // The camera padding follows the sheet's target height, so pins and routes stay in the visible map.
  const currentSheetHeight = heights[snap];
  const mapPadding = mapCameraPadding({ width, height: mapHeight, sheetHeight: currentSheetHeight + 8, panelVisible, navigating: navigation.visible, fontScale });
  const message = location.message || feedback.message;
  const dismissMessage = () => location.message ? location.setMessage("") : feedback.dismiss();
  const overlayPosition = { bottom: !wide && panelVisible ? currentSheetHeight + 24 : 88, left: wide && panelVisible ? SIDE_SHEET_WIDTH + 8 : 16, right: 16 };
  return (
    <SafeAreaView className="flex-1 bg-surface" edges={["top", "bottom"]}>
      <View className="flex-1">
        <AppMap
          height={mapHeight}
          padding={mapPadding}
          attributionLeft={wide && panelVisible && !navigation.visible ? SIDE_SHEET_WIDTH - 4 : 8}
          attributionTop={navigation.visible ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 8 : 68}
        />
        {navigation.visible ? (
          <NavigationPanel {...navigation} following={camera.following} onRecenter={camera.recenterGuidance}
            onStop={() => { void navigation.stop(); }} onRetry={() => { void navigation.retry(); }} onMute={() => { void navigation.toggleMuted(); }}
            onConfirmTransit={action => { void navigation.confirmTransit(action); }} onReplan={() => { void planner.replanFromNavigation(); }} />
        ) : <>
          <View pointerEvents="box-none" className="absolute left-3 right-3 top-20 flex-row items-start justify-between">
            <View className="flex-1" pointerEvents="none">
              {location.locating ? <Text accessibilityLiveRegion="polite" className="self-start rounded-full bg-surface-raised px-3 py-2 text-sm text-secondary">Ricerca della posizione…</Text>
                : !location.coordinate && camera.view === "overview" ? <Text accessibilityLabel="Vista panoramica di Torino, non la tua posizione" className="self-start rounded-full bg-surface-raised px-3 py-2 text-sm text-secondary">Panoramica di Torino</Text>
                  : null}
            </View>
            {location.locating ? (
              <View style={{ elevation: 3 }} accessible accessibilityLabel="Ricerca della posizione in corso" className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
                <ActivityIndicator color={colors.action} />
              </View>
            ) : <IconButton floating icon="locate-outline" label="Usa la mia posizione" onPress={locate} />}
          </View>
          {message ? <View style={overlayPosition} className="absolute"><Notice tone="caution" text={message} action="Chiudi" onAction={dismissMessage} /></View> : null}
          {camera.areaChanged && (search.hasSearch || tab === "transit") && !selectedPlace(tasks) && !selectedStop(tasks) ? (
            <View style={[overlayPosition, { elevation: 3 }]} className="absolute max-w-[95%] items-center self-center rounded-2xl bg-surface-raised">
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
            <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, wide ? { right: undefined, width: SIDE_SHEET_WIDTH } : null]}>
              <TaskSheet snap={snap} resting={resting} heights={heights} now={now} />
            </View>
          ) : (
            <View pointerEvents="box-none" style={{ position: "absolute", bottom: 12, left: 12, right: 12 }} className="flex-row justify-center gap-2">
              {ROOT_SHORTCUTS.map(item => (
                <Pressable key={item.id} accessibilityRole="button" onPress={() => shell.openTab(item.id)} style={{ elevation: 3 }}
                  className="min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-surface-raised px-5">
                  <Icon name={item.icon} size={22} color={colors.action} />
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
