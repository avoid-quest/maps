import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useThemeColors } from "../theme/ThemeProvider";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** System-style outline icons. Decorative unless the parent supplies an accessibility label. */
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const colors = useThemeColors();
  return <Ionicons name={name} size={size} color={color ?? colors.textPrimary} accessibilityElementsHidden importantForAccessibility="no" />;
}
