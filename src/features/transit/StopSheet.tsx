import { View } from "react-native";
import type { Stop } from "../../domain/types";
import { savedTravel } from "../../services/saved-travel";
import { Button, Notice } from "../../ui";
import { useFeedback } from "../app/feedback";
import { usePlannerContext } from "../planner/usePlanner";
import { savedTravelFailureMessage } from "./SavedTravelPanel";
import { StopBoardPanel } from "./StopBoardPanel";
import { useTransitContext } from "./useTransit";

/** A stop's arrivals and alerts, with saving and directions on foot. */
export function StopSheet({ stop, now }: { stop: Stop; now: number }) {
  const transit = useTransitContext();
  const { beginRoute } = usePlannerContext();
  const { openLink } = useFeedback();
  const saved = transit.isStopSaved(stop.id);
  const saveError = savedTravelFailureMessage(transit.savedTravel.stopsFailure);
  return (
    <View className="gap-3 py-2">
      {saveError ? <Notice tone="danger" text={saveError} /> : null}
      <Button
        variant="secondary" icon={saved ? "bookmark" : "bookmark-outline"}
        loading={transit.stopsBusy} disabled={transit.savedTravel.stopsStatus === "loading"}
        onPress={() => transit.mutateSavedStops(() => saved ? savedTravel.removeStop(stop.id) : savedTravel.saveStop(stop.id))}
      >{saved ? "Rimuovi fermata salvata" : "Salva fermata"}</Button>
      <StopBoardPanel stop={stop} state={transit.board} now={now} onLink={openLink}
        onDirections={() => {
          void beginRoute({
            id: `stop:${stop.id}`, name: `Fermata ${stop.name}`, coordinate: stop.coordinate,
            category: "Fermata GTT", source: "GTT", attributions: ["Dati GTT"],
          }, "walk");
        }}
      />
    </View>
  );
}
