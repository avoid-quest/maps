import { Pressable, Text, View } from "react-native";
import { colors } from "../theme/tokens";
import { Icon, type IconName } from "./Controls";

/** A row that opens an external destination such as a website or phone number. */
export function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-16 flex-row items-center gap-3 border-b border-[#E2E8F0] py-3"
    >
      <Icon name={icon} color={colors.blue} />
      <View className="flex-1">
        <Text className="font-semibold text-[#17243C]">{title}</Text>
        <Text numberOfLines={1} className="mt-1 text-sm text-[#59667A]">
          {subtitle}
        </Text>
      </View>
      <Icon name="open-outline" size={17} color={colors.muted} />
    </Pressable>
  );
}
