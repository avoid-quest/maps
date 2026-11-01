import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { rowDividerColors } from "./control-styles";
import { Icon, type IconName } from "./Icon";
import { PressableSurface } from "./PressableSurface";
import { Num, Text } from "./Text";

/**
 * A list entry that reads like a departure board: leading glyph or badge, a 16 sp title with a
 * secondary line, and right-aligned Geist Mono metadata (a distance or time) with an optional note
 * beneath it. Rows are separated by hairlines, not cards. The divider colour is inline from the
 * resolved palette so a live theme switch repaints it (see control-styles.ts).
 */
export function ListRow({ title, subtitle, subtitleLines = 2, detail, meta, metaNote, icon, leading, trailing, onPress, kind = "navigate", accessibilityLabel, accessibilityHint, divider = true }: {
  title: string;
  subtitle?: string;
  /** Lines shown before truncation; 0 shows the whole text (disclosures, notices). */
  subtitleLines?: number;
  /** A third, smaller line such as an address. */
  detail?: string;
  /** Right-aligned monospaced metadata such as a distance or time. */
  meta?: string;
  /** A short qualifier under `meta`, such as "dal centro". */
  metaNote?: string;
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
    {leading ?? (icon ? <View className="w-7 items-center"><Icon name={icon} size={20} color={colors.textSecondary} /></View> : null)}
    <View className="min-w-0 flex-1 gap-0.5">
      <Text className="text-base font-medium leading-6 text-primary" numberOfLines={2}>{title}</Text>
      {subtitle ? <Text className="text-sm leading-5 text-secondary" numberOfLines={subtitleLines || undefined}>{subtitle}</Text> : null}
      {detail ? <Text className="text-sm leading-5 text-secondary" numberOfLines={1}>{detail}</Text> : null}
    </View>
    {meta ? <View className="max-w-[40%] shrink-0 items-end">
      <Num numberOfLines={1} className="text-base text-primary">{meta}</Num>
      {metaNote ? <Text numberOfLines={1} className="text-xs text-secondary">{metaNote}</Text> : null}
    </View> : null}
    {trailing}
    {onPress && kind !== "none" ? <Icon name={kind === "external" ? "open-outline" : "chevron-forward"} size={18} color={colors.textSecondary} /> : null}
  </>;
  const style = divider ? { ...rowDividerColors(colors), borderBottomWidth: StyleSheet.hairlineWidth } : undefined;
  const className = "min-h-14 flex-row items-center gap-3 px-4 py-3";
  if (!onPress) return <View style={style} className={className}>{content}</View>;
  return (
    <PressableSurface
      surfaceStyle={style}
      contentClassName={className}
      rippleColor={`${colors.textPrimary}14`}
      accessibilityRole={kind === "external" ? "link" : "button"}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, detail, meta, metaNote].filter(Boolean).join(", ")}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
    >
      {content}
    </PressableSurface>
  );
}
