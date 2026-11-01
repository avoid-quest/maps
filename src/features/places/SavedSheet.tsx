import { savedTravel } from "../../services/saved-travel";
import { EmptyState, SheetFlatList } from "../../ui";
import { usePlannerContext } from "../planner/usePlanner";
import { SavedTravelPanel } from "../transit/SavedTravelPanel";
import { useTransitContext } from "../transit/useTransit";
import { PlaceRow } from "./PlaceRow";
import { usePlacesContext } from "./usePlaces";

/** Salvati: the saved journey and stops, then saved places. */
export function SavedSheet() {
  const { saved, openPlace } = usePlacesContext();
  const transit = useTransitContext();
  const planner = usePlannerContext();
  return (
    <SheetFlatList
      data={saved}
      keyExtractor={place => place.id}
      renderItem={({ item }) => <PlaceRow place={item} saved onPress={() => openPlace(item)} />}
      ListHeaderComponent={
        <SavedTravelPanel
          snapshot={transit.savedTravel} journeyBusy={planner.journeyBusy} stopsBusy={transit.stopsBusy}
          onOpenJourney={planner.restoreJourney} onClearJourney={planner.clearJourney}
          onOpenStop={transit.openStop}
          onRemoveStop={id => transit.mutateSavedStops(() => savedTravel.removeStop(id))}
          onClearStops={() => transit.mutateSavedStops(() => savedTravel.clearStops())}
        />
      }
      ListEmptyComponent={<EmptyState icon="bookmark-outline" title="Nessun luogo salvato" description="Tocca Salva in un luogo." />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}
