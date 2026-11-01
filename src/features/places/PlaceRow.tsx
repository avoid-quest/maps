import type { Place } from "../../domain/types";
import { categoryLabel } from "../../services";
import { useThemeColors } from "../../theme";
import { Icon, ListRow, type IconName } from "../../ui";
import { formatDistance } from "../../ui/format";
import { View } from "react-native";

function placeIcon(place: Place): IconName {
  const label = `${place.name} ${place.category ?? ""}`.toLowerCase();
  return /bar|caff|caf|coffee/.test(label) ? "cafe-outline"
    : /shop|nego|cloth|abbigl/.test(label) ? "bag-handle-outline"
      : /super|market|spesa/.test(label) ? "basket-outline"
        : /food|rist|pizza|burger|mangiare/.test(label) ? "restaurant-outline"
          : "location-outline";
}

export function PlaceRow({ place, saved, onPress }: { place: Place; saved: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const category = categoryLabel(place.category);
  const distance = place.distanceMeters != null ? formatDistance(place.distanceMeters) : "";
  return (
    <ListRow
      title={place.name}
      subtitle={[category, distance].filter(Boolean).join(" · ")}
      detail={place.address ?? undefined}
      icon={placeIcon(place)}
      trailing={saved ? <View accessibilityLabel="Salvato"><Icon name="bookmark" size={16} color={colors.action} /></View> : undefined}
      accessibilityLabel={[place.name, category, distance, place.address, saved ? "salvato" : ""].filter(Boolean).join(", ")}
      onPress={onPress}
    />
  );
}
