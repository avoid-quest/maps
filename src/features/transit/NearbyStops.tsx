import { View } from "react-native";
import { useThemeColors } from "../../theme";
import { EmptyState, Icon, ListRow, SheetFlatList } from "../../ui";
import { formatDistance } from "../../ui/format";
import { useTransitContext } from "./useTransit";

/** Trasporti: stops around the explicit search area. */
export function NearbyStops() {
  const colors = useThemeColors();
  const { nearbyStops, openStop } = useTransitContext();
  return (
    <SheetFlatList
      data={nearbyStops}
      keyExtractor={stop => stop.id}
      renderItem={({ item }) => (
        <ListRow
          title={item.name}
          subtitle={`Fermata ${item.code} · ${item.lines.slice(0, 6).join(", ") || "GTT"}`}
          meta={formatDistance(item.distanceMeters)}
          leading={<View className="h-10 w-10 items-center justify-center rounded-lg bg-surface-muted"><Icon name="bus-outline" size={20} color={colors.textPrimary} /></View>}
          onPress={() => openStop(item)}
        />
      )}
      ListEmptyComponent={<EmptyState icon="bus-outline" title="Nessuna fermata in quest’area" description="Sposta la mappa verso Torino e cerca di nuovo nell’area." />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}
