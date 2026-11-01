import { Text, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { lineAccessibilityLabel, lineBadgeColors, type TransitMode } from "./transit-line";

const shapes: Record<TransitMode | "line", { radius: number; icon?: IconName; outlined?: boolean }> = {
  bus: { radius: 999, icon: "bus-outline" },
  tram: { radius: 6, icon: "train-outline" },
  metro: { radius: 3, icon: "subway-outline" },
  rail: { radius: 0, icon: "train", outlined: true },
  line: { radius: 999 },
};

/**
 * Line identity: the line name in its operator colour when known (AA fallback otherwise), with a
 * mode-specific shape and glyph so metro, tram, bus and rail differ without relying on colour.
 */
export function TransitLineBadge({ line, mode, color, textColor, size = "md" }: {
  line: string; mode?: TransitMode; color?: string | null; textColor?: string | null; size?: "md" | "lg";
}) {
  const theme = useThemeColors();
  const colors = lineBadgeColors(color, textColor, { background: theme.textPrimary, text: theme.surface });
  const shape = shapes[mode ?? "line"];
  const large = size === "lg";
  return (
    <View
      accessible
      accessibilityLabel={lineAccessibilityLabel(line, mode)}
      style={{ backgroundColor: colors.background, borderRadius: shape.radius, minWidth: large ? 56 : 44, minHeight: large ? 36 : 28, ...(shape.outlined ? { borderWidth: 2, borderColor: colors.text } : {}) }}
      className="flex-row items-center justify-center gap-1 self-start px-2"
    >
      {shape.icon ? <Icon name={shape.icon} size={large ? 16 : 14} color={colors.text} /> : null}
      <Text numberOfLines={1} style={{ color: colors.text }} className={`${large ? "text-lg" : "text-base"} font-bold`}>{line}</Text>
    </View>
  );
}
