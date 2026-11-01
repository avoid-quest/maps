/** WCAG 2.x colour arithmetic for opaque sRGB hex colours (`#RGB` or `#RRGGBB`). */
export type Rgb = readonly [red: number, green: number, blue: number];

export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected an opaque #RGB or #RRGGBB colour, got ${hex}`);
  const digits = match[1]!.length === 3 ? [...match[1]!].map(digit => digit + digit).join('') : match[1]!;
  return [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16)) as unknown as Rgb;
}

/** Space-separated channels, the form NativeWind expects inside `rgb(var(--name) / <alpha-value>)`. */
export function rgbChannels(hex: string): string {
  return parseHex(hex).join(' ');
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex).map(linear) as unknown as Rgb;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA: 4.5:1 for normal text; 3:1 for large text and meaningful non-text graphics. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;
