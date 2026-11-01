import { ActivityIndicator, Text, View } from "react-native";
import { colors } from "../theme/tokens";

export function Loading({ label }: { label: string }) {
  return (
    <View className="flex-row items-center justify-center gap-3 py-8">
      <ActivityIndicator color={colors.blue} />
      <Text className="text-sm text-[#59667A]">{label}</Text>
    </View>
  );
}
