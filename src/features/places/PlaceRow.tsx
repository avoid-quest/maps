import { View } from "react-native";
import type { Place } from "../../domain/types";
import { useThemeColors } from "../../theme";
import { Icon, ListRow, type IconName } from "../../ui";
import { distanceFrom, type DistanceReference } from "../map/distance-reference";
import { placeCategoryLabel } from "./category-label";

function placeIcon(place: Place): IconName {
  const label = `${place.name} ${place.category ?? ""}`.toLowerCase();
  return /bar|caff|caf|coffee/.test(label) ? "cafe-outline"
    : /shop|nego|cloth|abbigl/.test(label) ? "bag-handle-outline"
      : /super|market|spesa/.test(label) ? "basket-outline"
        : /food|rist|restaurant|pizza|burger|mangiare/.test(label) ? "restaurant-outline"
          : "location-outline";
}

/** A place in a list, with its distance from the device or, labelled, from the map centre. */
export function PlaceRow({ place, saved, reference, onPress }: { place: Place; saved: boolean; reference: DistanceReference; onPress: () => void }) {
  const colors = useThemeColors();
  const category = placeCategoryLabel(place.category);
  const distance = distanceFrom(reference, place.coordinate);
  return (
    <ListRow
      title={place.name}
      subtitle={category}
      meta={distance.value}
      metaNote={distance.note ?? undefined}
      detail={place.address ?? undefined}
      icon={placeIcon(place)}
      trailing={saved ? <View accessibilityLabel="Salvato"><Icon name="bookmark" size={16} color={colors.textPrimary} /></View> : undefined}
      accessibilityLabel={[place.name, category, distance.spoken, place.address, saved ? "salvato" : ""].filter(Boolean).join(", ")}
      onPress={onPress}
    />
  );
}
