import { Linking, Text, View } from "react-native";
import { useThemeColors } from "../../theme";
import { Button, Disclosure, Icon, IconButton, Notice, SegmentedControl } from "../../ui";
import { formatDistance } from "../../ui/format";
import type { PlannerTask } from "../app/task-model";
import { useMapContext } from "../map/useMapModel";
import { useNavigationContext } from "../navigation/useNavigation";
import { useTransitContext } from "../transit/useTransit";
import { JourneyResults, TransitTimeForm } from "./JourneyPlanner";
import { journeyDate, journeyTime } from "./journey-presentation";
import { TRAVEL_MODES } from "./travel-modes";
import { usePlannerContext } from "./usePlanner";

/** Route planning preview: origin, mode, time, alternatives and saving. */
export function PlannerSheet({ task, now }: { task: PlannerTask; now: number }) {
  const colors = useThemeColors();
  const planner = usePlannerContext();
  const { location, locate } = useMapContext();
  const navigation = useNavigationContext();
  const { openJourneyStop } = useTransitContext();
  const { route, plans, error, loading: routing, refresh, retainedSelection } = planner.routes;
  const { mode, transitTime, savedJourneyVisible, journeyBusy } = planner;
  const originPending = task.originStep === "locating";
  const pickingOrigin = task.originStep === "picking";
  const journey = planner.savedTravel;
  return (
    <View className="gap-3 px-4 py-2">
      {navigation.error ? <Notice tone="danger" text={navigation.error} action="Impostazioni app" onAction={() => { void Linking.openSettings(); }} /> : null}
      <View className="flex-row items-center gap-1 rounded-2xl border border-divider bg-surface-raised pl-3">
        <View className="min-w-0 flex-1 py-2">
          <Text numberOfLines={1} className="text-sm text-secondary">Da: {task.origin.label}</Text>
          <Text numberOfLines={1} className="mt-0.5 text-base font-semibold text-primary">A: {task.destination.name}</Text>
        </View>
        <IconButton icon="locate-outline" label="Parti dalla mia posizione" disabled={location.locating} onPress={locate} />
        <IconButton icon="map-outline" label="Scegli la partenza sulla mappa" active={pickingOrigin} onPress={planner.pickOriginOnMap} />
      </View>
      <SegmentedControl accessibilityLabel="Mezzo di trasporto" options={TRAVEL_MODES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))} value={mode} onChange={planner.setMode} />
      {mode === "transit" ? (
        <TransitTimeForm key={JSON.stringify(transitTime)} value={transitTime} disabled={routing || originPending || pickingOrigin} onSubmit={planner.submitTransitTime} />
      ) : null}
      {pickingOrigin ? null : mode === "transit" && route ? (
        <JourneyResults plans={plans} selected={route} onSelect={planner.selectJourney} onRefresh={refresh} loading={routing} error={error}
          now={now} query={transitTime} saved={savedJourneyVisible} retained={retainedSelection} onOpenStop={openJourneyStop} />
      ) : (routing && !route) || originPending ? null : error && !route ? (
        <Notice tone="danger" text={error} action="Riprova" onAction={refresh} />
      ) : route ? (
        <Disclosure title="Dettagli percorso">
          <Text className="text-sm leading-5 text-secondary">Consultato il {journeyDate(route.fetchedAt)} alle {journeyTime(route.fetchedAt)}. {savedJourneyVisible ? "Da aggiornare." : ""}</Text>
          {error ? <Notice tone="danger" text={`${error} Mostro il percorso precedente.`} /> : null}
          <Button variant="secondary" icon="refresh-outline" loading={routing} onPress={refresh}>Ricalcola percorso</Button>
          {route.warnings.map((warning, index) => <Notice key={index} tone="caution" text={warning} />)}
          {route.legs.map((leg, index) => (
            <View key={index} className="border-t border-divider pt-2">
              {leg.steps.map((step, stepIndex) => (
                <View key={stepIndex} className="min-h-14 flex-row items-center gap-3 border-b border-divider py-3">
                  <Icon name={stepIndex === leg.steps.length - 1 ? "flag-outline" : "arrow-up-outline"} size={19} color={colors.action} />
                  <Text className="flex-1 text-base leading-6 text-primary">{step.instruction}</Text>
                  <Text className="text-sm text-secondary">{formatDistance(step.distanceMeters)}</Text>
                </View>
              ))}
            </View>
          ))}
          <Text className="text-sm leading-5 text-secondary">{route.source} · senza traffico in tempo reale. Dati © OpenStreetMap contributors.</Text>
        </Disclosure>
      ) : !originPending ? (
        <Button variant="secondary" icon="refresh-outline" onPress={refresh}>Calcola percorso</Button>
      ) : null}
      {route && !pickingOrigin && !originPending ? (
        <View className="gap-3 border-t border-divider pt-3">
          {planner.journeySaveError ? <Notice tone="danger" text={planner.journeySaveError} /> : null}
          {savedJourneyVisible ? (
            <Button variant="secondary" icon="trash-outline" loading={journeyBusy} onPress={planner.clearJourney}>Rimuovi viaggio</Button>
          ) : (
            <Button variant="secondary" icon="bookmark-outline" loading={journeyBusy} disabled={routing || retainedSelection || journey.journeyStatus === "loading"} onPress={planner.saveJourney}>
              {journey.journey || journey.journeyStatus === "unavailable" ? "Sostituisci viaggio" : "Salva viaggio"}
            </Button>
          )}
        </View>
      ) : null}
    </View>
  );
}
