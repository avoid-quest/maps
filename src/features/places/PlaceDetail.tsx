import { Pressable, Text, View } from "react-native";
import type { Place } from "../../domain/types";
import { categoryLabel } from "../../services";
import { ActionRow } from "../../ui/ActionRow";
import { Button, Disclosure } from "../../ui/Controls";
import { useFeedback } from "../app/feedback";
import { usePlannerContext } from "../planner/usePlanner";
import { usePlacesContext } from "./usePlaces";

export function PlaceDetail({ place }: { place: Place }) {
  const { isSaved, toggleSaved } = usePlacesContext();
  const { beginRoute } = usePlannerContext();
  const { openLink } = useFeedback();
  const saved = isSaved(place.id);
  return (
    <View className="gap-3 p-4">
      <View>
        <Text className="text-base text-[#59667A]">
          {categoryLabel(place.category)}
        </Text>
        {place.address ? (
          <Text className="mt-2 text-sm leading-5 text-[#17243C]">
            {place.address}
          </Text>
        ) : null}
      </View>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            icon="arrow-up-outline"
            onPress={() => beginRoute()}
          >
            Indicazioni
          </Button>
        </View>
        <Button
          secondary
          icon={saved ? "bookmark" : "bookmark-outline"}
          onPress={() => toggleSaved(place)}
        >
          {saved ? "Salvato" : "Salva"}
        </Button>
      </View>
      {place.website ? (
        <ActionRow
          icon="globe-outline"
          title="Sito web"
          subtitle={place.website.replace(/^https?:\/\//, "")}
          onPress={() => openLink(place.website!)}
        />
      ) : null}
      {place.phone ? (
        <ActionRow
          icon="call-outline"
          title="Chiama"
          subtitle={place.phone}
          onPress={() => openLink(`tel:${place.phone}`)}
        />
      ) : null}
      <Disclosure title="Dettagli">
        <Text className="text-xs text-[#59667A]">Orari non disponibili</Text>
      <Text className="text-xs leading-5 text-[#59667A]">
        Fonte: {place.source}
        {place.dataUpdatedAt
          ? `\nDati del ${place.dataUpdatedAt}`
          : ""}
        {place.attributions.length
          ? `\n${place.attributions.join("\n")}`
          : ""}
      </Text>
      <Pressable
        accessibilityRole="link"
        className="min-h-12 justify-center"
        onPress={() =>
          openLink(
            `https://www.openstreetmap.org/?mlat=${place.coordinate.latitude}&mlon=${place.coordinate.longitude}#map=19/${place.coordinate.latitude}/${place.coordinate.longitude}`,
          )
        }
      >
        <Text className="text-sm font-semibold text-[#2359D7]">
          Visualizza su OpenStreetMap
        </Text>
      </Pressable>
      </Disclosure>
    </View>
  );
}
