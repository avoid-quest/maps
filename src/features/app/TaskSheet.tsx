import { ScrollView, Text, View } from "react-native";
import { colors } from "../../theme/tokens";
import { IconButton } from "../../ui/Controls";
import { PlaceDetail } from "../places/PlaceDetail";
import { SavedSheet } from "../places/SavedSheet";
import { PlannerSheet } from "../planner/PlannerSheet";
import { RouteActions } from "../planner/RouteActions";
import { categoryTitle } from "../search/categories";
import { CategoryShortcuts } from "../search/CategoryShortcuts";
import { SearchResults } from "../search/SearchResults";
import { useSearchContext, type Search } from "../search/useSearch";
import { SettingsSheet } from "../settings/SettingsSheet";
import { NearbyStops } from "../transit/NearbyStops";
import { StopSheet } from "../transit/StopSheet";
import { useSheet } from "./sheet";
import { topTask, type Task } from "./task-model";
import { useShellActions } from "./useShellActions";
import { useTaskState } from "./useTaskModel";

function taskTitle(task: Task, search: Search): string {
  switch (task.kind) {
    case "settings": return "Privacy e fonti";
    case "journeyStop": case "stop": return task.stop.name;
    case "planner": return "Percorso";
    case "place": return task.place.name;
    case "transit": return "Trasporti";
    case "saved": return "Salvati";
    case "browse": case "search": return search.query.trim() || categoryTitle(search.category) || "Cerca sulla mappa";
  }
}

function TaskContent({ task, search, now }: { task: Task; search: Search; now: number }) {
  switch (task.kind) {
    case "settings": return <SettingsSheet />;
    case "planner": return <PlannerSheet task={task} now={now} />;
    case "place": return <PlaceDetail place={task.place} />;
    case "journeyStop": case "stop": return <StopSheet stop={task.stop} now={now} />;
    case "transit": return <NearbyStops />;
    case "saved": return <SavedSheet />;
    case "search": return search.hasSearch ? <SearchResults /> : <CategoryShortcuts />;
    case "browse": return null;
  }
}

/** The single task card: one task owns the sheet at a time. */
export function TaskSheet({ height, wide, fontScale, now }: { height: number; wide: boolean; fontScale: number; now: number }) {
  const tasks = useTaskState();
  const sheet = useSheet();
  const search = useSearchContext();
  const { closeTask, closeTopTask } = useShellActions();
  const top = topTask(tasks);
  return (
    <View testID="map-sheet" style={{ position: "absolute", left: 12, right: wide ? undefined : 12, bottom: 8, width: wide ? 410 : undefined, height, borderColor: colors.line, borderWidth: 1, borderRadius: 20, overflow: "hidden" }} className="bg-white">
      <View style={{ height: Math.max(56, 48 * fontScale) }} className="flex-row items-center border-b border-[#E2E8F0] px-2">
        <IconButton icon="arrow-back" label="Indietro" onPress={closeTopTask} />
        <Text accessibilityRole="header" numberOfLines={2} className="min-w-0 flex-1 text-base leading-5 font-semibold text-[#17243C]">{taskTitle(top, search)}</Text>
        <IconButton icon={sheet.expanded ? "chevron-down" : "chevron-up"} label={sheet.expanded ? "Riduci scheda" : "Espandi scheda"} onPress={sheet.toggle} />
        <IconButton icon="close" label="Chiudi scheda" onPress={closeTask} />
      </View>
      <ScrollView
        ref={sheet.scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <TaskContent task={top} search={search} now={now} />
      </ScrollView>
      {top.kind === "planner" ? <RouteActions task={top} /> : null}
    </View>
  );
}
