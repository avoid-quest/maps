import { Pressable, Text, View } from "react-native";
import { colors } from "../../theme/tokens";
import { EmptyState, Icon } from "../../ui/Controls";
import { formatDistance } from "../../ui/format";
import { useTransitContext } from "./useTransit";

/** Trasporti: stops around the explicit search area. */
export function NearbyStops() {
  const { nearbyStops, openStop } = useTransitContext();
  return nearbyStops.length ? (
    <>
      {nearbyStops.map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() => openStop(item)}
          className="mx-5 min-h-20 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
        >
          <View className="h-11 w-11 items-center justify-center rounded-xl bg-[#FFF5DE]">
            <Icon name="bus-outline" color={colors.amber} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-[#17243C]">
              {item.name}
            </Text>
            <Text className="mt-1 text-xs text-[#59667A]">
              {item.code} ·{" "}
              {item.lines.slice(0, 6).join(", ") || "Fermata GTT"}
            </Text>
          </View>
          <Text className="text-xs text-[#59667A]">
            {formatDistance(item.distanceMeters)}
          </Text>
          <Icon
            name="chevron-forward"
            size={16}
            color={colors.muted}
          />
        </Pressable>
      ))}
    </>
  ) : (
    <EmptyState
      icon="bus-outline"
      title="Nessuna fermata in quest’area"
      description="Sposta la mappa verso Torino e cerca di nuovo nell’area."
    />
  );
}
