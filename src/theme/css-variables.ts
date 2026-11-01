import { rgbChannels } from './contrast';
import { kebabTokenName, palettes, themeColorNames, type ColorScheme } from './palette';

export type ThemeVariables = Record<`--color-${string}`, string>;

/** CSS custom properties consumed by the semantic Tailwind colours in `tailwind.config.js`. */
export function themeVariables(scheme: ColorScheme): ThemeVariables {
  const colors = palettes[scheme].colors;
  return Object.fromEntries(themeColorNames.map(name => [`--color-${kebabTokenName(name)}`, rgbChannels(colors[name])])) as ThemeVariables;
}
