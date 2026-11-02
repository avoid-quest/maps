import { View } from "react-native";
import type { Stop } from "../../domain/types";
import { savedTravel } from "../../services/saved-travel";
import { IconButton, Notice } from "../../ui";
import { useFeedback } from "../app/feedback";
import { usePlannerContext } from "../planner/usePlanner";
import { savedTravelFailureMessage } from "./SavedTravelPanel";
import { StopBoardPanel } from "./StopBoardPanel";
import { useTransitContext } from "./useTransit";

/** Save or unsave the open stop: an icon beside refresh, so departures stay first in the sheet. */
export function StopSheetActions({ stop }: { stop: Stop }) {
  const transit = useTransitContext();
  const saved = transit.isStopSaved(stop.id);
  return (
    <IconButton
      icon={saved ? "bookmark" : "bookmark-outline"}
      label={saved ? `Rimuovi la fermata ${stop.code} dai salvati` : `Salva la fermata ${stop.code}`}
      active={saved}
      busy={transit.stopsBusy}
      disabled={transit.savedTravel.stopsStatus === "loading"}
      onPress={() => { void transit.mutateSavedStops(() => saved ? savedTravel.removeStop(stop.id) : savedTravel.saveStop(stop.id)); }}
    />
  );
}

/** A stop's departures first, then alerts and directions on foot. */
export function StopSheet({ stop, now }: { stop: Stop; now: number }) {
  const transit = useTransitContext();
  const { beginRoute } = usePlannerContext();
  const { openLink } = useFeedback();
  const saveError = savedTravelFailureMessage(transit.savedTravel.stopsFailure);
  return (
    <View className="gap-3 py-1">
      {saveError ? <View className="px-4"><Notice tone="danger" text={saveError} /></View> : null}
      <StopBoardPanel stop={stop} state={transit.board} now={now} onLink={openLink} actions={<StopSheetActions stop={stop} />}
        transitous={{ shown: transit.fallback.stopId === stop.id, consent: transit.consent, board: transit.fallback.board, open: transit.fallback.open, close: transit.fallback.close, accept: transit.acceptTransitous }}
        onDirections={() => {
          void beginRoute({
            id: `stop:${stop.id}`, name: /^fermata\b/i.test(stop.name) ? stop.name : `Fermata ${stop.name}`, coordinate: stop.coordinate,
            category: "Fermata GTT", source: "GTT", attributions: ["Dati GTT"],
          }, "walk");
        }}
      />
    </View>
  );
}
