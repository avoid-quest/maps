import type { ReactNode } from "react";
import { ActivityIndicator } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { buttonColors, type ButtonVariant } from "./control-styles";
import { Icon, type IconName } from "./Icon";
import { PressableSurface } from "./PressableSurface";
import { Text } from "./Text";

export type { ButtonVariant };

/**
 * One action per intent: `primary` is the brand pill (white on black, black on white), `secondary`
 * a hairline pill, `quiet` a text action inside content. Always at least 48 dp tall. Colours are
 * on a surface separate from the ripple so a live theme switch repaints them (see PressableSurface).
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
  const tone = buttonColors(colors, variant);
  const inactive = disabled || loading;
  return (
    <PressableSurface
      surfaceStyle={{ backgroundColor: tone.backgroundColor, borderColor: tone.borderColor, borderWidth: variant === "secondary" ? 1 : 0, opacity: disabled ? 0.4 : 1 }}
      className="rounded-full"
      contentClassName={`min-h-12 flex-row items-center justify-center gap-2 ${variant === "quiet" ? "px-2" : "px-5"} py-2.5`}
      rippleColor={`${tone.foreground}26`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
    >
      {loading ? <ActivityIndicator color={tone.foreground} /> : icon ? <Icon name={icon} size={20} color={tone.foreground} /> : null}
      <Text style={{ color: tone.foreground }} className="shrink text-center text-base font-semibold">{children}</Text>
    </PressableSurface>
  );
}
