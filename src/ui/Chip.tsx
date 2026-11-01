import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

/** A compact choice or shortcut. Selection adds a border and weight, not only a tint. */
export function Chip({ label, icon, selected = false, onPress, accessibilityLabel }: {
  label: string; icon?: IconName; selected?: boolean; onPress: () => void; accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      android_ripple={{ color: `${colors.textPrimary}1F` }}
      className={`min-h-12 flex-row items-center gap-2 overflow-hidden rounded-full border px-4 ${selected ? "border-action bg-action-subtle" : "border-divider bg-surface-raised"}`}
    >
      {icon ? <Icon name={icon} size={18} color={selected ? colors.action : colors.textSecondary} /> : null}
      <Text className={`text-sm ${selected ? "font-semibold text-action" : "text-primary"}`}>{label}</Text>
    </Pressable>
  );
}

export interface SegmentOption<T extends string> { value: T; label: string; icon?: IconName }

/** Mutually exclusive choices such as Sistema/Chiaro/Scuro or travel modes, exposed as a radio group. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel, disabled = false }: {
  options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel: string; disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} className="flex-row rounded-2xl bg-surface-muted p-1">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            className={`min-h-12 flex-1 items-center justify-center gap-0.5 rounded-xl px-1 ${selected ? "border border-divider bg-surface-raised" : ""} ${disabled ? "opacity-40" : ""}`}
          >
            {option.icon ? <Icon name={option.icon} size={20} color={selected ? colors.action : colors.textSecondary} /> : null}
            <Text numberOfLines={1} className={`text-sm ${selected ? "font-semibold text-primary" : "text-secondary"}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
