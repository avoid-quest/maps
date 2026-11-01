import { View } from "react-native";
import { AppSheet, IconButton, SheetHeader, SheetScrollView, type SheetHeights, type SheetSnap } from "../../ui";
import { PlaceDetail } from "../places/PlaceDetail";
import { SavedSheet } from "../places/SavedSheet";
import { PlannerSheet } from "../planner/PlannerSheet";
import { ROUTE_ACTIONS_HEIGHT, RouteActions } from "../planner/RouteActions";
import { categoryTitle } from "../search/categories";
import { CategoryShortcuts } from "../search/CategoryShortcuts";
import { SearchResults } from "../search/SearchResults";
import { useSearchContext, type Search } from "../search/useSearch";
import { SettingsSheet } from "../settings/SettingsSheet";
import { NearbyStops } from "../transit/NearbyStops";
import { StopSheet } from "../transit/StopSheet";
import { useSheet } from "./sheet";
import { sheetHeaderNavigation, toggleExpands, toggledSnap } from "./sheet-model";
import { detailKey, topTask, type Task } from "./task-model";
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

/** Lists own a virtualized scroller; other tasks scroll as one document. */
function TaskContent({ task, search, now }: { task: Task; search: Search; now: number }) {
  switch (task.kind) {
    case "search": return search.hasSearch ? <SearchResults /> : <SheetScrollView><CategoryShortcuts /></SheetScrollView>;
    case "transit": return <NearbyStops />;
    case "saved": return <SavedSheet />;
    case "settings": return <SheetScrollView><SettingsSheet /></SheetScrollView>;
    case "planner": return <SheetScrollView><PlannerSheet task={task} now={now} /></SheetScrollView>;
    case "place": return <SheetScrollView><PlaceDetail place={task.place} /></SheetScrollView>;
    case "journeyStop": case "stop": return <SheetScrollView><StopSheet stop={task.stop} now={now} /></SheetScrollView>;
    case "browse": return null;
  }
}

/** The single task card: one task owns the sheet at a time. */
export function TaskSheet({ snap, resting, heights, now }: { snap: SheetSnap; resting: SheetSnap; heights: SheetHeights; now: number }) {
  const tasks = useTaskState();
  const sheet = useSheet();
  const search = useSearchContext();
  const { closeTask, closeTopTask } = useShellActions();
  const top = topTask(tasks);
  const navigation = sheetHeaderNavigation(tasks);
  const expandTo = toggledSnap(snap, resting, heights);
  const expands = toggleExpands(snap, resting, heights);
  const header = (
    <SheetHeader
      title={taskTitle(top, search)}
      onBack={navigation.back ? closeTopTask : undefined}
      onClose={closeTask}
      closeLabel="Chiudi e torna alla mappa"
      actions={
        <IconButton icon={expands ? "chevron-up" : "chevron-down"}
          label={expands ? "Espandi scheda" : "Riduci scheda"} onPress={() => sheet.request(expandTo)} />
      }
    />
  );
  return (
    <AppSheet testID="map-sheet" snap={snap} heights={heights} onSnapChange={sheet.request} header={header}
      footer={top.kind === "planner" ? <RouteActions task={top} /> : undefined} footerHeight={top.kind === "planner" ? ROUTE_ACTIONS_HEIGHT : 0}>
      <View key={detailKey(tasks)} style={{ flex: 1 }}>
        <TaskContent task={top} search={search} now={now} />
      </View>
    </AppSheet>
  );
}
