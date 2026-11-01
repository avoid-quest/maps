import { View } from "react-native";
import { useThemeColors } from "../../theme";
import { EmptyState, Icon, ListRow, SheetFlatList } from "../../ui";
import { distanceFrom } from "../map/distance-reference";
import { useDistanceReference } from "../map/useDistanceReference";
import { useTransitContext } from "./useTransit";

/** Trasporti: stops around the explicit search area. */
export function NearbyStops() {
  const colors = useThemeColors();
  const { nearbyStops, openStop } = useTransitContext();
  const reference = useDistanceReference();
  return (
    <SheetFlatList
      data={nearbyStops}
      keyExtractor={stop => stop.id}
      extraData={reference}
      renderItem={({ item }) => {
        const distance = distanceFrom(reference, item.coordinate);
        return <ListRow
          title={item.name}
          subtitle={`Fermata ${item.code} · ${item.lines.slice(0, 6).join(", ") || "GTT"}`}
          meta={distance.value}
          metaNote={distance.note ?? undefined}
          accessibilityLabel={`${item.name}, fermata ${item.code}, linee ${item.lines.slice(0, 6).join(", ") || "GTT"}, ${distance.spoken}`}
          leading={<View className="w-7 items-center"><Icon name="bus-outline" size={20} color={colors.textSecondary} /></View>}
          onPress={() => openStop(item)}
        />;
      }}
      ListEmptyComponent={<EmptyState icon="bus-outline" title="Nessuna fermata in quest’area" description="Sposta la mappa verso Torino e cerca di nuovo nell’area." />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}
