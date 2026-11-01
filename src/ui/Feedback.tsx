import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "./Text";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

export function Loading({ label }: { label: string }) {
  const colors = useThemeColors();
  return (
    <View accessibilityLiveRegion="polite" className="flex-row items-center justify-center gap-3 py-6">
      <ActivityIndicator color={colors.action} />
      <Text className="text-sm text-secondary">{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, description }: { icon: IconName; title: string; description: string }) {
  const colors = useThemeColors();
  return (
    <View className="items-center px-7 py-8">
      <View className="mb-3 h-14 w-14 items-center justify-center">
        <Icon name={icon} size={26} color={colors.textSecondary} />
      </View>
      <Text className="text-center text-lg font-semibold text-primary">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-6 text-secondary">{description}</Text>
    </View>
  );
}

/** Secondary explanations expand inside the sheet, without changing its geometry. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} className="min-h-12 flex-row items-center gap-2">
        <Text className="flex-1 text-sm font-semibold text-secondary">{title}</Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
      </Pressable>
      {open ? <View className="gap-3 pb-3">{children}</View> : null}
    </View>
  );
}
