import { useMemo } from "react";
import { View } from "react-native";
import { useThemeColors } from "../../theme";
import { EmptyState, Icon, ListRow, SectionHeader, SheetFlatList } from "../../ui";
import { distanceFrom } from "../map/distance-reference";
import { useDistanceReference } from "../map/useDistanceReference";
import { nearbyStopSubtitle } from "./stop-labels";
import { useTransitContext } from "./useTransit";

/** Trasporti: pilot rail stations and GTT stops around the explicit search area. */
export function NearbyStops() {
  const colors = useThemeColors();
  const { nearbyStops, nearbyStations, openStop, openStation } = useTransitContext();
  const reference = useDistanceReference();
  // The column shows distances from the device (or the map centre); list the stops in that order.
  const rows = useMemo(() => nearbyStops.map(stop => ({ stop, distance: distanceFrom(reference, stop.coordinate) }))
    .sort((a, b) => a.distance.meters - b.distance.meters), [nearbyStops, reference]);
  const stations = useMemo(() => nearbyStations.map(station => ({ station, distance: distanceFrom(reference, station.coordinate) }))
    .sort((a, b) => a.distance.meters - b.distance.meters), [nearbyStations, reference]);
  const header = stations.length ? <View>
    <SectionHeader title="Stazioni ferroviarie" />
    {stations.map(({ station, distance }) => <ListRow
      key={station.key}
      title={station.name}
      subtitle="Treni · orari da Transitous"
      meta={distance.value}
      metaNote={distance.note ?? undefined}
      accessibilityLabel={`${station.name}, stazione ferroviaria, orari da Transitous, ${distance.spoken}`}
      leading={<View className="w-7 items-center"><Icon name="train-outline" size={20} color={colors.textSecondary} /></View>}
      onPress={() => openStation(station)}
    />)}
    <SectionHeader title="Fermate GTT" />
  </View> : null;
  return (
    <SheetFlatList
      data={rows}
      keyExtractor={row => row.stop.id}
      ListHeaderComponent={header}
      renderItem={({ item: { stop: item, distance } }) => {
        const subtitle = nearbyStopSubtitle(item);
        return <ListRow
          title={item.name}
          subtitle={subtitle}
          meta={distance.value}
          metaNote={distance.note ?? undefined}
          accessibilityLabel={`${item.name}, ${subtitle.replace(/^Fermata/, "fermata")}, ${distance.spoken}`}
          leading={<View className="w-7 items-center"><Icon name="bus-outline" size={20} color={colors.textSecondary} /></View>}
          onPress={() => openStop(item)}
        />;
      }}
      ListEmptyComponent={<EmptyState icon="bus-outline" title="Nessuna fermata in quest’area" description="Sposta la mappa verso Torino e cerca di nuovo nell’area." />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}
