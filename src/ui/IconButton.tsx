import { Pressable, StyleSheet } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { floatingControlColors } from "./control-styles";
import { Icon, type IconName } from "./Icon";

/**
 * A 48 dp icon-only control. `label` is required: it is the control's only accessible name.
 * `floating` puts the control on the map as a raised disc with a hairline (no shadow). Colours are
 * inline from the resolved palette so a live theme switch repaints them (see control-styles.ts).
 */
export function IconButton({ icon, label, onPress, active = false, disabled = false, floating = false }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  floating?: boolean;
}) {
  const colors = useThemeColors();
  const surface = floating || active ? floatingControlColors(colors, active) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      android_ripple={{ color: `${colors.textPrimary}1F`, borderless: true, radius: 24 }}
      style={{ backgroundColor: surface?.backgroundColor ?? "transparent", borderColor: surface?.borderColor ?? "transparent", borderWidth: floating ? StyleSheet.hairlineWidth : 0, opacity: disabled ? 0.4 : 1 }}
      className="h-12 w-12 items-center justify-center rounded-full"
    >
      <Icon name={icon} color={colors.textPrimary} />
    </Pressable>
  );
}
