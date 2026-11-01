import { Linking, View } from "react-native";
import { Text } from "../../ui/Text";
import { useThemeColors } from "../../theme";
import { Button, Disclosure, Icon, ListRow, Notice, Num, SegmentedControl, useHairlines } from "../../ui";
import { formatDistance } from "../../ui/format";
import type { PlannerTask } from "../app/task-model";
import { useNavigationContext } from "../navigation/useNavigation";
import { useTransitContext } from "../transit/useTransit";
import { useFeedback } from "../app/feedback";
import { EndpointEditor } from "./EndpointEditor";
import { JourneyResults } from "./JourneyPlanner";
import { PlannerEndpoints } from "./PlannerEndpoints";
import { TransitTimeControl } from "./TransitTimeControl";
import { journeyDate, journeyTime } from "./journey-presentation";
import { TRAVEL_MODES } from "./travel-modes";
import { usePlannerContext } from "./usePlanner";

/** Route planning preview: origin, mode, time, alternatives and saving. */
export function PlannerSheet({ task, now }: { task: PlannerTask; now: number }) {
  if (task.editing) return <EndpointEditor endpoint={task.editing} current={task.editing === "origin" ? task.origin.place ?? null : task.destination} />;
  return <PlannerPreview task={task} now={now} />;
}

function PlannerPreview({ task, now }: { task: PlannerTask; now: number }) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const planner = usePlannerContext();
  const { openInOtherApp } = useFeedback();
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
      <PlannerEndpoints task={task} />
      <SegmentedControl accessibilityLabel="Mezzo di trasporto" options={TRAVEL_MODES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))} value={mode} onChange={planner.setMode} />
      {mode === "transit" ? (
        <TransitTimeControl value={transitTime} disabled={originPending || pickingOrigin} onChange={planner.submitTransitTime} />
      ) : null}
      {pickingOrigin ? null : mode === "transit" && route ? (
        <JourneyResults plans={plans} selected={route} onSelect={planner.selectJourney} onRefresh={refresh} loading={routing} error={error}
          now={now} query={transitTime} saved={savedJourneyVisible} retained={retainedSelection} onOpenStop={openJourneyStop} />
      ) : (routing && !route) || originPending ? null : error && !route ? (
        <Notice tone="danger" text={error} action="Riprova" onAction={refresh} />
      ) : route ? (
        <Disclosure title="Dettagli percorso">
          <Text className="text-sm leading-5 text-secondary">Consultato il {journeyDate(route.fetchedAt)} alle <Num className="text-sm text-secondary">{journeyTime(route.fetchedAt)}</Num>. {savedJourneyVisible ? "Da aggiornare." : ""}</Text>
          {error ? <Notice tone="danger" text={`${error} Mostro il percorso precedente.`} /> : null}
          <Button variant="secondary" icon="refresh-outline" loading={routing} onPress={refresh}>Ricalcola percorso</Button>
          {route.warnings.map((warning, index) => <Notice key={index} tone="caution" text={warning} />)}
          {route.legs.map((leg, index) => (
            <View key={index} style={hairlines.top} className="pt-2">
              {leg.steps.map((step, stepIndex) => (
                <View key={stepIndex} style={hairlines.bottom} className="min-h-14 flex-row items-center gap-3 py-3">
                  <Icon name={stepIndex === leg.steps.length - 1 ? "flag-outline" : "arrow-up-outline"} size={19} color={colors.textPrimary} />
                  <Text className="flex-1 text-base leading-6 text-primary">{step.instruction}</Text>
                  <Num className="text-sm text-secondary">{formatDistance(step.distanceMeters)}</Num>
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
        <View style={hairlines.top} className="gap-3 pt-3">
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
      {pickingOrigin ? null : (
        <View style={hairlines.top} className="-mx-4">
          <ListRow kind="external" icon="map-outline" title="Apri in un’altra app" subtitle={`${task.destination.name} · Organic Maps o un’altra app di mappe`} divider={false}
            accessibilityHint="Sceglie un’app sul dispositivo; nessun dato viene inviato a servizi" onPress={() => { void openInOtherApp(task.destination); }} />
        </View>
      )}
    </View>
  );
}
