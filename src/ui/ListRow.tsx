import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

/**
 * A tappable list entry: optional leading icon or element, a 16 sp title, a secondary line,
 * trailing metadata and a chevron (in-app) or external-link marker.
 */
export function ListRow({ title, subtitle, subtitleLines = 2, detail, meta, icon, leading, trailing, onPress, kind = "navigate", accessibilityLabel, accessibilityHint, divider = true }: {
  title: string;
  subtitle?: string;
  /** Lines shown before truncation; 0 shows the whole text (disclosures, notices). */
  subtitleLines?: number;
  /** A third, smaller line such as an address. */
  detail?: string;
  /** Right-aligned metadata such as a distance. */
  meta?: string;
  icon?: IconName;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** `navigate` opens in-app detail, `external` leaves the app, `none` shows no marker. */
  kind?: "navigate" | "external" | "none";
  accessibilityLabel?: string;
  accessibilityHint?: string;
  divider?: boolean;
}) {
  const colors = useThemeColors();
  const content = <>
    {leading ?? (icon ? <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-muted"><Icon name={icon} size={20} color={colors.action} /></View> : null)}
    <View className="min-w-0 flex-1 gap-0.5">
      <Text className="text-base font-medium leading-6 text-primary" numberOfLines={2}>{title}</Text>
      {subtitle ? <Text className="text-sm leading-5 text-secondary" numberOfLines={subtitleLines || undefined}>{subtitle}</Text> : null}
      {detail ? <Text className="text-sm leading-5 text-secondary" numberOfLines={1}>{detail}</Text> : null}
    </View>
    {meta ? <Text numberOfLines={1} className="max-w-[40%] shrink-0 text-sm text-secondary">{meta}</Text> : null}
    {trailing}
    {onPress && kind !== "none" ? <Icon name={kind === "external" ? "open-outline" : "chevron-forward"} size={18} color={colors.textSecondary} /> : null}
  </>;
  const className = `min-h-14 flex-row items-center gap-3 px-4 py-3 ${divider ? "border-b border-divider" : ""}`;
  if (!onPress) return <View className={className}>{content}</View>;
  return (
    <Pressable
      accessibilityRole={kind === "external" ? "link" : "button"}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, detail, meta].filter(Boolean).join(", ")}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      android_ripple={{ color: `${colors.textPrimary}14` }}
      className={className}
    >
      {content}
    </Pressable>
  );
}
