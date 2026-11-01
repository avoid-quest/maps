import { View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, IconButton, Num, useHairlines } from "../../ui";
import { formatDistance, formatDuration } from "../../ui/format";
import type { PlannerTask } from "../app/task-model";
import { useMapContext } from "../map/useMapModel";
import { useNavigationContext } from "../navigation/useNavigation";
import { usePlannerContext } from "./usePlanner";

export const ROUTE_ACTIONS_HEIGHT = 72;

/** Summary and Avvia, anchored outside the scrolling details. */
export function RouteActions({ task }: { task: PlannerTask }) {
  const planner = usePlannerContext();
  const hairlines = useHairlines();
  const { camera } = useMapContext();
  const navigation = useNavigationContext();
  const { route, error, loading: routing, retainedSelection } = planner.routes;
  const originPending = task.originStep === "locating";
  const pickingOrigin = task.originStep === "picking";
  return (
    <View testID="route-actions" style={[{ height: ROUTE_ACTIONS_HEIGHT }, hairlines.top]} className="flex-row items-center gap-2 bg-surface px-3">
      <View className="flex-1">
        <Num numberOfLines={1} accessibilityLiveRegion="polite" className="text-lg font-semibold text-primary">{originPending || (routing && !route) ? "Calcolo del percorso…" : pickingOrigin ? "Tocca la partenza" : route ? `${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)}` : error ? "Percorso non disponibile" : "Anteprima del percorso"}</Num>
        <Text numberOfLines={1} className="text-sm text-secondary">{routing && route ? "Aggiornamento…" : error && route ? "Aggiornamento non riuscito · percorso precedente" : planner.savedJourneyVisible ? "Viaggio salvato · da aggiornare" : retainedSelection ? "Selezione da aggiornare" : navigation.supported ? "Anteprima" : "Navigazione su Android"}</Text>
      </View>
      {pickingOrigin ? <IconButton icon="close" label="Annulla scelta partenza" onPress={planner.cancelOriginPicking} /> : <IconButton icon="scan-outline" label="Mostra tutto il percorso" disabled={!route} onPress={camera.frameRoute} />}
      {navigation.supported ? <Button icon="navigate-outline" disabled={!route || !navigation.ready || routing || retainedSelection || pickingOrigin || originPending} onPress={planner.startGuidance}>Avvia</Button> : null}
    </View>
  );
}
