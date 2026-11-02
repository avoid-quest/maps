import { View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, IconButton, Num, useHairlines } from "../../ui";
import { formatDistance, formatDuration } from "../../ui/format";
import type { PlannerTask } from "../app/task-model";
import { useMapContext } from "../map/useMapModel";
import { useNavigationContext } from "../navigation/useNavigation";
import { journeyDuration, journeyTime } from "./journey-presentation";
import { plannerPrimaryAction } from "./transit-journey";
import { usePlannerContext } from "./usePlanner";

export const ROUTE_ACTIONS_HEIGHT = 72;

/**
 * Summary and the mode-correct primary action, anchored outside the scrolling details: Avvia for
 * road modes; in Mezzi, Cerca percorsi until alternatives exist, then Segui viaggio.
 */
export function RouteActions({ task }: { task: PlannerTask }) {
  const planner = usePlannerContext();
  const hairlines = useHairlines();
  const { camera } = useMapContext();
  const navigation = useNavigationContext();
  const { route, error, loading: routing, retainedSelection } = planner.routes;
  const originPending = task.originStep === "locating";
  const pickingOrigin = task.originStep === "picking";
  const transit = planner.mode === "transit";
  const action = plannerPrimaryAction({
    mode: planner.mode, route, loading: routing, retained: retainedSelection, picking: pickingOrigin, originPending,
    originReady: task.origin.ready, supported: navigation.supported, navigationReady: navigation.ready, navigationBusy: navigation.busy === "start",
  });
  const summary = originPending || (routing && !route) ? (transit ? "Cerco i percorsi…" : "Calcolo del percorso…")
    : pickingOrigin ? "Tocca la partenza"
      : route && transit && route.mode === "transit" ? `${journeyTime(route.departureAt)}–${journeyTime(route.arrivalAt)}`
        : route ? `${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)}`
          : error ? "Percorso non disponibile" : transit ? "Nessuna ricerca" : "Anteprima del percorso";
  const status = action.reason && action.kind !== "search" ? action.reason
    : routing && route ? "Aggiornamento…" : error && route ? "Aggiornamento non riuscito · percorso precedente"
      : planner.savedJourneyVisible ? "Viaggio salvato · da aggiornare" : retainedSelection ? "Selezione da aggiornare"
        : transit ? (route ? journeyDuration(route.durationSeconds) : "Mezzi pubblici · MATO") : navigation.supported ? "Anteprima" : "Navigazione su Android";
  return (
    <View testID="route-actions" style={[{ height: ROUTE_ACTIONS_HEIGHT }, hairlines.top]} className="flex-row items-center gap-2 bg-surface px-3">
      <View className="min-w-0 flex-1">
        <Num numberOfLines={1} accessibilityLiveRegion="polite" className="text-lg font-semibold text-primary">{summary}</Num>
        <Text numberOfLines={1} className="text-sm text-secondary">{status}</Text>
      </View>
      {pickingOrigin ? <IconButton icon="close" label="Annulla scelta partenza" onPress={planner.cancelOriginPicking} /> : <IconButton icon="scan-outline" label="Mostra tutto il percorso" disabled={!route} onPress={camera.frameRoute} />}
      {action.kind === "search" ? (
        <Button icon="search-outline" loading={action.loading} disabled={!action.enabled} onPress={planner.routes.refresh}>{action.label}</Button>
      ) : action.kind === "follow" ? (
        <Button icon="navigate-outline" loading={action.loading} disabled={!action.enabled} accessibilityHint={action.reason} onPress={planner.startGuidance}>{action.label}</Button>
      ) : action.kind === "start" ? (
        <Button icon="navigate-outline" disabled={!action.enabled} onPress={planner.startGuidance}>{action.label}</Button>
      ) : null}
    </View>
  );
}
