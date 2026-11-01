import { savedTravel } from "../../services/saved-travel";
import { EmptyState } from "../../ui";
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
    <>
      <SavedTravelPanel
        snapshot={transit.savedTravel} journeyBusy={planner.journeyBusy} stopsBusy={transit.stopsBusy}
        onOpenJourney={planner.restoreJourney} onClearJourney={planner.clearJourney}
        onOpenStop={transit.openStop}
        onRemoveStop={id => transit.mutateSavedStops(() => savedTravel.removeStop(id))}
        onClearStops={() => transit.mutateSavedStops(() => savedTravel.clearStops())}
      />
      {saved.length ? (
        saved.map((place) => (
          <PlaceRow
            key={place.id}
            place={place}
            saved
            onPress={() => openPlace(place)}
          />
        ))
      ) : (
        <EmptyState
          icon="bookmark-outline"
          title="Nessun luogo salvato"
          description="Tocca Salva in un luogo."
        />
      )}
    </>
  );
}
