import { View } from "react-native";
import { Text } from "../../ui/Text";
import type { Place } from "../../domain/types";
import { Button, Disclosure, ListRow, Num } from "../../ui";
import { detailDistance } from "../map/distance-reference";
import { useDistanceReference } from "../map/useDistanceReference";
import { useFeedback } from "../app/feedback";
import { usePlannerContext } from "../planner/usePlanner";
import { placeCategoryLabel } from "./category-label";
import { confidenceLabel, freshnessLabel, sourceLines, websiteLabel } from "./place-detail-model";
import { usePlacesContext } from "./usePlaces";

export function PlaceDetail({ place }: { place: Place }) {
  const { isSaved, toggleSaved } = usePlacesContext();
  const { beginRoute } = usePlannerContext();
  const { openLink, openInOtherApp } = useFeedback();
  const saved = isSaved(place.id);
  // A selected place shows a distance only from a fresh device fix (see distance-reference.ts).
  const distance = detailDistance(useDistanceReference(), place.coordinate);
  const category = placeCategoryLabel(place.category);
  const confidence = confidenceLabel(place);
  return (
    <View className="gap-3 py-2">
      <View className="gap-1 px-4">
        <Text accessibilityLabel={`${category}${distance ? `, ${distance.spoken}` : ""}`} className="text-base text-secondary">{category}{distance ? <> · <Num className="text-base text-secondary">{distance.value}</Num></> : null}</Text>
        {place.address ? <Text className="text-base leading-6 text-primary">{place.address}</Text> : null}
        {place.kind === "area" ? <Text className="text-sm leading-5 text-secondary">Posizione indicativa del quartiere, non un confine.</Text> : null}
      </View>
      <View className="flex-row gap-2 px-4">
        <View className="flex-1"><Button icon="navigate-outline" onPress={() => beginRoute()}>Indicazioni</Button></View>
        <Button variant="secondary" icon={saved ? "bookmark" : "bookmark-outline"} accessibilityLabel={saved ? "Salvato, rimuovi dai salvati" : "Salva luogo"} onPress={() => toggleSaved(place)}>
          {saved ? "Salvato" : "Salva"}
        </Button>
      </View>
      <View>
        {place.website ? <ListRow kind="external" icon="globe-outline" title="Sito web" subtitle={websiteLabel(place.website)} subtitleLines={1} onPress={() => openLink(place.website!)} /> : null}
        {place.phone ? <ListRow kind="external" icon="call-outline" title="Chiama" subtitle={place.phone} onPress={() => openLink(`tel:${place.phone}`)} /> : null}
        <ListRow kind="external" icon="map-outline" title="Apri in un’altra app" subtitle="Organic Maps o un’altra app di mappe sul dispositivo"
          accessibilityHint="Sceglie un’app sul dispositivo. Questa app non invia dati; l’app scelta riceve il luogo e applica la propria privacy" onPress={() => { void openInOtherApp(place); }} />
      </View>
      <View className="px-4">
        <Disclosure title="Fonti e dettagli">
          {/* No bundled or online source supplies opening hours; unknown stays unknown. */}
          <Text className="text-sm leading-5 text-secondary">Orari di apertura non disponibili nelle fonti usate.</Text>
          {confidence ? <Text className="text-sm leading-5 text-secondary">{confidence}</Text> : null}
          <Text className="text-sm leading-5 text-secondary">{freshnessLabel(place)}</Text>
          <View className="gap-1">
            <Text className="text-sm font-semibold text-primary">Fonte: {place.source}</Text>
            {sourceLines(place).map((line, index) => <Text key={index} className="text-sm leading-5 text-secondary">{line}</Text>)}
          </View>
          <Button variant="quiet" role="link" icon="open-outline" onPress={() => openLink(`https://www.openstreetmap.org/?mlat=${place.coordinate.latitude}&mlon=${place.coordinate.longitude}#map=19/${place.coordinate.latitude}/${place.coordinate.longitude}`)}>
            Visualizza su OpenStreetMap
          </Button>
        </Disclosure>
      </View>
    </View>
  );
}
