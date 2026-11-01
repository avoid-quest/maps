import { Platform, Pressable } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

/**
 * A 48 dp icon-only control. `label` is required: it is the control's only accessible name.
 * `floating` lifts the control above the map with a raised surface and shadow.
 */
export function IconButton({ icon, label, onPress, active = false, disabled = false, floating = false, tone = "default" }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  floating?: boolean;
  tone?: "default" | "action";
}) {
  const colors = useThemeColors();
  const color = active || tone === "action" ? colors.action : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      android_ripple={{ color: `${colors.textPrimary}1F`, borderless: true, radius: 24 }}
      style={floating ? { elevation: 3, ...(Platform.OS === "web" ? { boxShadow: "0 2px 8px rgba(0,0,0,0.18)" } : {}) } : undefined}
      className={`h-12 w-12 items-center justify-center rounded-full ${active ? "bg-action-subtle" : floating ? "bg-surface-raised" : ""} ${disabled ? "opacity-40" : ""}`}
    >
      <Icon name={icon} color={color} />
    </Pressable>
  );
}
