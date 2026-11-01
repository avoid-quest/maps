import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "quiet";

const surfaces: Record<ButtonVariant, string> = {
  primary: "bg-action",
  secondary: "bg-action-subtle",
  quiet: "",
};
const labels: Record<ButtonVariant, string> = {
  primary: "text-on-action",
  secondary: "text-action",
  quiet: "text-action",
};

/**
 * One action per intent: `primary` for the task's main step, `secondary` for supporting actions,
 * `quiet` for low-emphasis links inside content. Always at least 48 dp tall.
 */
export function Button({ children, icon, onPress, variant = "primary", disabled = false, loading = false, accessibilityLabel, accessibilityHint }: {
  children: ReactNode;
  icon?: IconName;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const colors = useThemeColors();
  const foreground = variant === "primary" ? colors.onAction : colors.action;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      android_ripple={{ color: variant === "primary" ? `${colors.onAction}33` : `${colors.action}26`, borderless: false }}
      className={`min-h-12 flex-row items-center justify-center gap-2 overflow-hidden rounded-full ${variant === "quiet" ? "px-2" : "px-5"} py-2.5 ${surfaces[variant]} ${disabled ? "opacity-40" : ""}`}
    >
      {loading ? <ActivityIndicator color={foreground} /> : icon ? <Icon name={icon} size={20} color={foreground} /> : null}
      <Text className={`shrink text-center text-base font-semibold ${labels[variant]}`}>{children}</Text>
    </Pressable>
  );
}
