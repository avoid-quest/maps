import type { ThemeColors } from '../theme/palette';

/**
 * Colours for pressable surfaces, computed from the resolved palette and applied as inline styles.
 * On Android, NativeWind did not repaint className colours on Pressable after a live scheme switch
 * (floating map buttons and list dividers kept the previous theme), while `useThemeColors()` consumers
 * always re-render. Brand: no decorative shadows; floating controls and rows use hairlines.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export function buttonColors(colors: ThemeColors, variant: ButtonVariant) {
  switch (variant) {
    case 'primary': return { backgroundColor: colors.action, borderColor: colors.action, foreground: colors.onAction };
    case 'secondary': return { backgroundColor: 'transparent', borderColor: colors.textSecondary, foreground: colors.textPrimary };
    case 'quiet': return { backgroundColor: 'transparent', borderColor: 'transparent', foreground: colors.textPrimary };
  }
}

/** Map controls floating over the basemap: a raised disc with a hairline, or the subtle active fill. */
export function floatingControlColors(colors: ThemeColors, active: boolean) {
  return { backgroundColor: active ? colors.actionSubtle : colors.surfaceRaised, borderColor: colors.divider };
}

export function rowDividerColors(colors: ThemeColors) {
  return { borderBottomColor: colors.divider };
}

export function chipColors(colors: ThemeColors, selected: boolean) {
  return selected
    ? { backgroundColor: colors.action, borderColor: colors.action, foreground: colors.onAction }
    : { backgroundColor: 'transparent', borderColor: colors.divider, foreground: colors.textPrimary };
}

export function segmentColors(colors: ThemeColors, selected: boolean) {
  return selected
    ? { backgroundColor: colors.surfaceRaised, borderColor: colors.divider, foreground: colors.textPrimary }
    : { backgroundColor: 'transparent', borderColor: 'transparent', foreground: colors.textSecondary };
}
