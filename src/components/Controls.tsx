import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { colors } from "../theme/tokens";

export type IconName = ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`h-12 w-12 items-center justify-center rounded-full ${active ? "bg-[#ECF2FF]" : "bg-white"} ${disabled ? "opacity-40" : ""}`}
    >
      <Icon name={icon} color={active ? colors.blue : colors.ink} />
    </Pressable>
  );
}

export function Button({
  children,
  icon,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
}: {
  children: ReactNode;
  icon?: IconName;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-5 py-3 ${secondary ? "bg-[#ECF2FF]" : "bg-[#2359D7]"} ${disabled ? "opacity-40" : ""}`}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? colors.blue : "white"} />
      ) : icon ? (
        <Icon name={icon} size={20} color={secondary ? colors.blue : "white"} />
      ) : null}
      <Text
        className={`text-base font-semibold ${secondary ? "text-[#2359D7]" : "text-white"}`}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function Notice({
  text,
  action,
  onAction,
  danger = false,
}: {
  text: string;
  action?: string;
  onAction?: () => void;
  danger?: boolean;
}) {
  return (
    <View
      className={`flex-row items-start gap-2 rounded-2xl px-4 py-3 ${danger ? "bg-[#FFF1EB]" : "bg-[#F3F6FA]"}`}
    >
      <Icon
        name={danger ? "alert-circle-outline" : "information-circle-outline"}
        size={18}
        color={danger ? "#9B391B" : colors.muted}
      />
      <View className="flex-1">
        <Text className="text-sm leading-5 text-[#59667A]">{text}</Text>
        {action && onAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            className="min-h-11 justify-center"
          >
            <Text className="font-semibold text-[#2359D7]">{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <View className="items-center px-7 py-8">
      <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-[#ECF2FF]">
        <Icon name={icon} size={26} color={colors.blue} />
      </View>
      <Text className="text-center text-xl font-semibold text-[#17243C]">
        {title}
      </Text>
      <Text className="mt-2 text-center text-sm leading-6 text-[#59667A]">
        {description}
      </Text>
    </View>
  );
}
