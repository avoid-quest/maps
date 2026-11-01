import { Pressable, Text, View } from "react-native";
import type { Place } from "../../domain/types";
import { categoryLabel } from "../../services";
import { colors } from "../../theme/tokens";
import { Icon, type IconName } from "../../ui/Controls";
import { formatDistance } from "../../ui/format";

export function PlaceRow({
  place,
  saved,
  onPress,
}: {
  place: Place;
  saved: boolean;
  onPress: () => void;
}) {
  const label = `${place.name} ${place.category ?? ""}`.toLowerCase();
  const icon: IconName = /bar|caff|caf|coffee/.test(label)
    ? "cafe-outline"
    : /shop|nego|cloth|abbigl/.test(label)
      ? "bag-handle-outline"
      : /super|market|spesa/.test(label)
        ? "basket-outline"
        : /food|rist|pizza|burger|mangiare/.test(label)
          ? "restaurant-outline"
          : "location-outline";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="mx-4 min-h-20 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-[#F3F6FA]">
        <Icon name={icon} color={colors.blue} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="flex-shrink text-base font-semibold text-[#17243C]"
            numberOfLines={2}
          >
            {place.name}
          </Text>
          {saved ? (
            <Icon name="bookmark" size={13} color={colors.blue} />
          ) : null}
        </View>
        <Text className="mt-1 text-sm text-[#59667A]" numberOfLines={1}>
          {categoryLabel(place.category)}
          {place.distanceMeters != null
            ? ` · ${formatDistance(place.distanceMeters)}`
            : ""}
        </Text>
        {place.address ? (
          <Text className="mt-1 text-xs text-[#59667A]" numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
