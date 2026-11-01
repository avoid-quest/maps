import { palettes } from './palette';

const light = palettes.light.colors;

/**
 * @deprecated Light-only aliases kept for existing importers. Use semantic classes (`text-primary`,
 * `bg-action`) or `useThemeColors()` so values follow the resolved appearance.
 */
export const colors = {
  ink: light.textPrimary,
  muted: light.textSecondary,
  blue: light.action,
  paleBlue: light.actionSubtle,
  teal: light.live,
  paper: light.surfaceRaised,
  surface: light.surfaceMuted,
  line: light.divider,
  amber: light.caution,
};

export { palettes, themeColorNames, type ColorScheme, type MapColors, type Palette, type ThemeColors } from './palette';
