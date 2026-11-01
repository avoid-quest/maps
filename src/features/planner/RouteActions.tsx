import { Text, View } from "react-native";
import { Button, IconButton } from "../../ui/Controls";
import { formatDistance, formatDuration } from "../../ui/format";
import type { PlannerTask } from "../app/task-model";
import { useMapContext } from "../map/useMapModel";
import { useNavigationContext } from "../navigation/useNavigation";
import { usePlannerContext } from "./usePlanner";

/** Summary and Avvia, anchored outside the scrolling details. */
export function RouteActions({ task }: { task: PlannerTask }) {
  const planner = usePlannerContext();
  const { camera } = useMapContext();
  const navigation = useNavigationContext();
  const { route, error, loading: routing, retainedSelection } = planner.routes;
  const originPending = task.originStep === "locating";
  const pickingOrigin = task.originStep === "picking";
  return (
    <View testID="route-actions" style={{ height: 72, flexShrink: 0 }} className="flex-row items-center gap-2 border-t border-[#E2E8F0] px-3">
      <View className="flex-1">
        <Text numberOfLines={1} accessibilityLiveRegion="polite" className="text-lg font-semibold text-[#17243C]">{originPending || (routing && !route) ? "Calcolo del percorso…" : pickingOrigin ? "Tocca la partenza" : route ? `${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)}` : error ? "Percorso non disponibile" : "Anteprima del percorso"}</Text>
        <Text numberOfLines={1} className="text-xs text-[#59667A]">{routing && route ? "Aggiornamento…" : error && route ? "Aggiornamento non riuscito · percorso precedente" : planner.savedJourneyVisible ? "Viaggio salvato · da aggiornare" : retainedSelection ? "Selezione da aggiornare" : navigation.supported ? "Anteprima" : "Navigazione su Android"}</Text>
      </View>
      {pickingOrigin ? <IconButton icon="close" label="Annulla scelta partenza" onPress={planner.cancelOriginPicking} /> : <IconButton icon="scan-outline" label="Mostra tutto il percorso" disabled={!route} onPress={camera.frameRoute} />}
      {navigation.supported ? <Button icon="navigate-outline" disabled={!route || !navigation.ready || routing || retainedSelection || pickingOrigin || originPending} onPress={planner.startGuidance}>Avvia</Button> : null}
    </View>
  );
}
