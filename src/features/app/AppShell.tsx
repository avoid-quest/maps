import { useRef } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
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
import { sheetHeight, useSheet } from "./sheet";
import { rootTab, selectedPlace, selectedStop, sheetVisible } from "./task-model";
import { TaskSheet } from "./TaskSheet";
import { useNow } from "./useNow";
import { useShellActions } from "./useShellActions";
import { useTaskState } from "./useTaskModel";

const ROOT_SHORTCUTS = [
  { id: "transit", label: "Trasporti", icon: "bus-outline" },
  { id: "saved", label: "Salvati", icon: "bookmark-outline" },
] as const;

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
  const currentSheetHeight = sheetHeight({ tasks, hasSearch: search.hasSearch, expanded: sheet.expanded, availableHeight, fontScale });
  const mapPadding = mapCameraPadding({ width, height: mapHeight, sheetHeight: currentSheetHeight, panelVisible, navigating: navigation.visible, fontScale });
  const message = location.message || feedback.message;
  const dismissMessage = () => location.message ? location.setMessage("") : feedback.dismiss();
  const overlayPosition = { bottom: !wide && panelVisible ? currentSheetHeight + 24 : 88, left: wide && panelVisible ? 442 : 16, right: 16 };
  return (
    <SafeAreaView className="flex-1 bg-surface" edges={["top", "bottom"]}>
      <View className="flex-1">
        <AppMap
          height={mapHeight}
          padding={mapPadding}
          attributionLeft={wide && panelVisible && !navigation.visible ? 430 : 8}
          attributionTop={navigation.visible ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 8 : 68}
        />
        {navigation.visible ? (
          <NavigationPanel {...navigation} following={camera.following} onRecenter={camera.recenterGuidance}
            onStop={() => { void navigation.stop(); }} onRetry={() => { void navigation.retry(); }} onMute={() => { void navigation.toggleMuted(); }}
            onConfirmTransit={action => { void navigation.confirmTransit(action); }} onReplan={() => { void planner.replanFromNavigation(); }} />
        ) : <>
          <View
            pointerEvents="box-none"
            className="absolute left-3 right-3 top-20 flex-row items-start justify-between"
          >
            <View className="flex-1" pointerEvents="none">
              {location.locating ? <Text accessibilityLiveRegion="polite" className="self-start rounded-full bg-surface-raised px-3 py-2 text-sm text-secondary">Ricerca della posizione…</Text> : null}
            </View>
            <View
              style={{
                elevation: 3,
                boxShadow: "0 2px 8px #17243c18",
                borderRadius: 24,
              }}
            >
              {location.locating ? (
                <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
                  <ActivityIndicator color={colors.action} />
                </View>
              ) : (
                <IconButton
                  floating
                  icon="locate-outline"
                  label="Usa la mia posizione"
                  onPress={locate}
                />
              )}
            </View>
          </View>
          {message ? <View style={overlayPosition} className="absolute left-4 right-4"><Notice tone="caution" text={message} action="Chiudi" onAction={dismissMessage} /></View> : null}
          {camera.areaChanged && (search.hasSearch || tab === "transit") && !selectedPlace(tasks) && !selectedStop(tasks) ? (
            <View style={overlayPosition} className="absolute max-w-[95%] self-center rounded-2xl bg-surface-raised">
              <Button icon="search-outline" variant="secondary" onPress={searchArea}>
                Cerca in quest’area
              </Button>
              <Text className="px-3 pb-2 text-center text-sm text-secondary">{tab === "transit" ? "Fermate intorno al centro" : search.result.coverage.radiusMeters !== null ? `Raggio ${formatDistance(search.result.coverage.radiusMeters)} dal centro` : search.policy === "local-only" ? "Nomi nell’intero pacchetto locale" : "Nomi nel pacchetto; area come riferimento online"}</Text>
            </View>
          ) : null}
          <View className="absolute left-0 right-0 top-0 px-3 py-2">
            <View className="flex-row items-center gap-2">
              <SearchField />
              <IconButton
                floating
                icon="options-outline"
                label="Privacy e fonti"
                active={tasks.settings}
                onPress={shell.toggleSettings}
              />
            </View>
          </View>
          {panelVisible ? <TaskSheet height={currentSheetHeight} wide={wide} fontScale={fontScale} now={now} /> : null}
          {!panelVisible ? <View style={{ position: "absolute", bottom: 12, left: 12, right: 12 }} className="flex-row justify-center gap-2">
            {ROOT_SHORTCUTS.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => shell.openTab(item.id)}
                style={{ elevation: 3 }}
                className="min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-surface-raised px-5"
              >
                <View className="items-center">
                  <Icon name={item.icon} size={22} color={colors.action} />
                </View>
                <Text className="text-base font-medium text-primary">{item.label}</Text>
              </Pressable>
            ))}
          </View> : null}
        </>}
      </View>
    </SafeAreaView>
  );
}
