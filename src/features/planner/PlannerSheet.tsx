import { Linking, Pressable, Text, View } from "react-native";
import { colors } from "../../theme/tokens";
import { Button, Disclosure, Icon, IconButton, Notice } from "../../ui/Controls";
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
    <View className="gap-3 p-4">
      {navigation.error ? <Notice danger text={navigation.error} action="Impostazioni app" onAction={() => { void Linking.openSettings(); }} /> : null}
      <View className="flex-row items-center gap-2 border-b border-[#E2E8F0] pb-2">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-sm text-[#59667A]">Da: {task.origin.label}</Text>
          <Text numberOfLines={1} className="mt-1 text-sm font-semibold text-[#17243C]">A: {task.destination.name}</Text>
        </View>
        <IconButton icon="locate-outline" label="Parti dalla mia posizione" disabled={location.locating} onPress={locate} />
        <IconButton icon="map-outline" label="Scegli la partenza sulla mappa" onPress={planner.pickOriginOnMap} />
      </View>
      <View className="flex-row rounded-2xl bg-[#F3F6FA] p-1">
        {TRAVEL_MODES.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === item.id }}
            onPress={() => planner.setMode(item.id)}
            className={`min-h-12 flex-1 items-center justify-center gap-1 rounded-xl ${mode === item.id ? "bg-white" : ""}`}
          >
            <Icon
              name={item.icon}
              color={
                mode === item.id ? colors.blue : colors.muted
              }
            />
            <Text
              className={`text-xs ${mode === item.id ? "font-semibold text-[#2359D7]" : "text-[#59667A]"}`}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "transit" ? (
        <TransitTimeForm
          key={JSON.stringify(transitTime)}
          value={transitTime}
          disabled={routing || originPending || pickingOrigin}
          onSubmit={planner.submitTransitTime}
        />
      ) : null}
      {pickingOrigin ? null : mode === "transit" && route ? (
        <JourneyResults
          plans={plans}
          selected={route}
          onSelect={planner.selectJourney}
          onRefresh={refresh}
          loading={routing}
          error={error}
          now={now}
          query={transitTime}
          saved={savedJourneyVisible}
          retained={retainedSelection}
          onOpenStop={openJourneyStop}
        />
      ) : (routing && !route) || originPending ? null : error && !route ? (
        <Notice
          danger
          text={error}
          action="Riprova"
          onAction={refresh}
        />
      ) : route ? (
        <Disclosure title="Dettagli percorso">
          <Text className="text-xs leading-5 text-[#59667A]">Consultato il {journeyDate(route.fetchedAt)} alle {journeyTime(route.fetchedAt)}. {savedJourneyVisible ? "Da aggiornare." : ""}</Text>
          {error ? <Notice danger text={`${error} Mostro il percorso precedente.`} /> : null}
          <Button secondary icon="refresh-outline" loading={routing} onPress={refresh}>Ricalcola percorso</Button>
          {route.warnings.map((warning, index) => (
            <Notice key={index} text={warning} />
          ))}
          {route.legs.map((leg, index) => (
            <View
              key={index}
              className="border-t border-[#E2E8F0] pt-4"
            >
              {leg.steps.map((step, stepIndex) => (
                <View
                  key={stepIndex}
                  className="min-h-14 flex-row items-center gap-3 border-b border-[#F3F6FA] py-3"
                >
                  <Icon
                    name={
                      stepIndex === leg.steps.length - 1
                        ? "flag-outline"
                        : "arrow-up-outline"
                    }
                    size={19}
                    color={colors.blue}
                  />
                  <Text className="flex-1 text-sm leading-5 text-[#17243C]">
                    {step.instruction}
                  </Text>
                  <Text className="text-xs text-[#59667A]">
                    {formatDistance(step.distanceMeters)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
          <Text className="text-xs leading-5 text-[#59667A]">
            {route.source} · senza traffico in tempo reale. Dati © OpenStreetMap
            contributors.
          </Text>
        </Disclosure>
      ) : !originPending ? (
        <Button secondary icon="refresh-outline" onPress={refresh}>Calcola percorso</Button>
      ) : null}
      {route && !pickingOrigin && !originPending ? (
        <View className="gap-3 border-t border-[#E2E8F0] pt-4">
          {planner.journeySaveError ? <Notice danger text={planner.journeySaveError} /> : null}
          {savedJourneyVisible ? (
            <Button secondary icon="trash-outline" loading={journeyBusy} onPress={planner.clearJourney}>Rimuovi viaggio</Button>
          ) : (
            <Button secondary icon="bookmark-outline" loading={journeyBusy} disabled={routing || retainedSelection || journey.journeyStatus === "loading"} onPress={planner.saveJourney}>
              {journey.journey || journey.journeyStatus === "unavailable" ? "Sostituisci viaggio" : "Salva viaggio"}
            </Button>
          )}
        </View>
      ) : null}
    </View>
  );
}
