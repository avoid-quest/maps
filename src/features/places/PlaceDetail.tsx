import { View } from "react-native";
import { Text } from "../../ui/Text";
import type { Place } from "../../domain/types";
import { Button, Disclosure, ListRow } from "../../ui";
import { useFeedback } from "../app/feedback";
import { usePlannerContext } from "../planner/usePlanner";
import { placeCategoryLabel } from "./category-label";
import { usePlacesContext } from "./usePlaces";

export function PlaceDetail({ place }: { place: Place }) {
  const { isSaved, toggleSaved } = usePlacesContext();
  const { beginRoute } = usePlannerContext();
  const { openLink } = useFeedback();
  const saved = isSaved(place.id);
  return (
    <View className="gap-3 py-2">
      <View className="gap-1 px-4">
        <Text className="text-base text-secondary">{placeCategoryLabel(place.category)}</Text>
        {place.address ? <Text className="text-base leading-6 text-primary">{place.address}</Text> : null}
      </View>
      <View className="flex-row gap-2 px-4">
        <View className="flex-1"><Button icon="navigate-outline" onPress={() => beginRoute()}>Indicazioni</Button></View>
        <Button variant="secondary" icon={saved ? "bookmark" : "bookmark-outline"} accessibilityLabel={saved ? "Rimuovi dai salvati" : "Salva luogo"} onPress={() => toggleSaved(place)}>
          {saved ? "Salvato" : "Salva"}
        </Button>
      </View>
      <View>
        {place.website ? <ListRow kind="external" icon="globe-outline" title="Sito web" subtitle={place.website.replace(/^https?:\/\//, "")} onPress={() => openLink(place.website!)} /> : null}
        {place.phone ? <ListRow kind="external" icon="call-outline" title="Chiama" subtitle={place.phone} onPress={() => openLink(`tel:${place.phone}`)} /> : null}
      </View>
      <View className="px-4">
        <Disclosure title="Dettagli e fonte">
          <Text className="text-sm text-secondary">Orari non disponibili</Text>
          <Text className="text-sm leading-5 text-secondary">
            Fonte: {place.source}
            {place.dataUpdatedAt ? `\nDati del ${place.dataUpdatedAt}` : ""}
            {place.attributions.length ? `\n${place.attributions.join("\n")}` : ""}
          </Text>
          <Button variant="quiet" icon="open-outline" onPress={() => openLink(`https://www.openstreetmap.org/?mlat=${place.coordinate.latitude}&mlon=${place.coordinate.longitude}#map=19/${place.coordinate.latitude}/${place.coordinate.longitude}`)}>
            Visualizza su OpenStreetMap
          </Button>
        </Disclosure>
      </View>
    </View>
  );
}
