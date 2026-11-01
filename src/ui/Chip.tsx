import { Pressable, StyleSheet, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { chipColors, segmentColors } from "./control-styles";
import { Icon, type IconName } from "./Icon";
import { PressableSurface } from "./PressableSurface";
import { Text } from "./Text";

/** A compact choice or shortcut: a hairline pill; selection is the filled brand pill plus weight. */
export function Chip({ label, icon, selected = false, onPress, accessibilityLabel }: {
  label: string; icon?: IconName; selected?: boolean; onPress: () => void; accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  const tone = chipColors(colors, selected);
  return (
    <PressableSurface
      surfaceStyle={{ backgroundColor: tone.backgroundColor, borderColor: tone.borderColor, borderWidth: StyleSheet.hairlineWidth }}
      className="rounded-full"
      contentClassName="min-h-12 flex-row items-center gap-2 px-4"
      rippleColor={`${tone.foreground}26`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      {icon ? <Icon name={icon} size={18} color={tone.foreground} /> : null}
      <Text style={{ color: tone.foreground }} className={`text-sm ${selected ? "font-semibold" : "font-medium"}`}>{label}</Text>
    </PressableSurface>
  );
}

export interface SegmentOption<T extends string> { value: T; label: string; icon?: IconName }

/** Mutually exclusive choices such as Sistema/Chiaro/Scuro or travel modes, exposed as a radio group. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel, disabled = false }: {
  options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel: string; disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ backgroundColor: colors.surfaceMuted }} className="flex-row rounded-full p-1">
      {options.map(option => {
        const selected = option.value === value;
        const tone = segmentColors(colors, selected);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={{ backgroundColor: tone.backgroundColor, borderColor: tone.borderColor, borderWidth: StyleSheet.hairlineWidth, opacity: disabled ? 0.4 : 1 }}
            className="min-h-12 flex-1 items-center justify-center gap-0.5 rounded-full px-1"
          >
            {option.icon ? <Icon name={option.icon} size={20} color={tone.foreground} /> : null}
            <Text numberOfLines={1} style={{ color: tone.foreground }} className={`text-sm ${selected ? "font-semibold" : "font-medium"}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
