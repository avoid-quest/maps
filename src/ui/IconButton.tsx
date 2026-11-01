import { ActivityIndicator, StyleSheet } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { floatingControlColors } from "./control-styles";
import { Icon, type IconName } from "./Icon";
import { PressableSurface } from "./PressableSurface";

/**
 * A 48 dp icon-only control. `label` is required: it is the control's only accessible name.
 * `floating` puts the control on the map as a raised disc with a hairline (no shadow). The fill sits
 * on a surface separate from the ripple so a live theme switch repaints it (see PressableSurface).
 */
export function IconButton({ icon, label, onPress, active = false, disabled = false, floating = false, busy = false }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  floating?: boolean;
  /** Shows progress in place of the icon and announces the control as busy. */
  busy?: boolean;
}) {
  const colors = useThemeColors();
  const surface = floating || active ? floatingControlColors(colors, active) : null;
  return (
    <PressableSurface
      surfaceStyle={{ width: 48, height: 48, borderRadius: 24, backgroundColor: surface?.backgroundColor ?? "transparent", borderColor: surface?.borderColor ?? "transparent", borderWidth: floating ? StyleSheet.hairlineWidth : 0, opacity: disabled && !busy ? 0.4 : 1 }}
      contentClassName="flex-1 items-center justify-center"
      rippleColor={`${colors.textPrimary}1F`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, selected: active, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={4}
    >
      {busy ? <ActivityIndicator color={colors.textPrimary} /> : <Icon name={icon} color={colors.textPrimary} />}
    </PressableSurface>
  );
}
