import { basemapInks } from './brand-basemap';

/**
 * Semantic colour tokens. Components describe a role (surface, secondary text, action, stale data),
 * never a hue, so each role can resolve differently in light and dark appearance.
 *
 * Every text-role token is checked against every surface in `palette.test.ts` (WCAG AA 4.5:1).
 */
export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  /** Window, status/navigation bars and guidance chrome: pure black in dark, white in light. */
  chrome: string;
  /** Task-card body and list backgrounds (near-black in dark, off-white in light). */
  surface: string;
  /** Cards, controls and inputs lifted above `surface`. */
  surfaceRaised: string;
  /** Chips, pressed rows, segmented-control tracks and quiet fills. */
  surfaceMuted: string;
  textPrimary: string;
  /** Supporting text, metadata, placeholders and inactive icons. Still AA on every surface. */
  textSecondary: string;
  /** Hairlines and card borders. Decorative, not a text colour. */
  divider: string;
  /** The only accent: primary pill fill, links and active icons (white in dark, black in light). */
  action: string;
  /** Text or icon drawn on an `action` fill. */
  onAction: string;
  /** Selected chip or tinted row behind `action` or primary text. */
  actionSubtle: string;
  caution: string;
  cautionSubtle: string;
  /** Disruption, destructive actions and failures. */
  danger: string;
  dangerSubtle: string;
  success: string;
  successSubtle: string;
  /** Signal green: a realtime prediction from the operator feed, a current fix, verified data. */
  live: string;
  /** Transit: a timetable time without realtime confirmation. */
  scheduled: string;
  /** Transit: realtime data that is older than its freshness bound. */
  stale: string;
  /** Transit: a cancelled trip or stop call. Pair with text, never colour alone. */
  cancelled: string;
}

/** Colours for native map layers drawn over the basemap; see `map-style.ts`. */
export interface MapColors {
  /** Matches the bundled basemap background; use behind the map while the style loads. */
  background: string;
  routeLine: string;
  routeCasing: string;
  placeMarker: string;
  stopMarker: string;
  markerStroke: string;
  /** Selected markers are larger and use this ring so selection never relies on hue alone. */
  selectedMarkerStroke: string;
  labelText: string;
  labelHalo: string;
  /** The device position: the one live signal on the map, so it uses the live green. */
  userLocation: string;
  userLocationStroke: string;
  /** Realtime transit overlays (vehicles, confirmed departures). Pair with a label or shape. */
  live: string;
  /** Disruption or uncertainty overlays. Pair with a label or shape. */
  caution: string;
  coverage: string;
}

export interface Palette {
  scheme: ColorScheme;
  colors: ThemeColors;
  map: MapColors;
}

/**
 * avoid.quest family palette: zinc greyscale with white (dark) or black (light) as the only accent.
 * Colour carries meaning only: signal green for live/verified, amber for caution, red for disruption.
 */
const lightColors: ThemeColors = {
  chrome: '#FFFFFF',
  surface: '#FAFAFA',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F4F4F5',
  textPrimary: '#09090B',
  textSecondary: '#52525B',
  divider: '#E4E4E7',
  action: '#09090B',
  onAction: '#FAFAFA',
  actionSubtle: '#E4E4E7',
  caution: '#92400E',
  cautionSubtle: '#FEF3C7',
  danger: '#B91C1C',
  dangerSubtle: '#FEE2E2',
  success: '#066F44',
  successSubtle: '#DCFCE7',
  live: '#066F44',
  scheduled: '#3F3F46',
  stale: '#92400E',
  cancelled: '#B91C1C',
};

const darkColors: ThemeColors = {
  chrome: '#000000',
  surface: '#0B0B0C',
  surfaceRaised: '#111113',
  surfaceMuted: '#1C1C1F',
  textPrimary: '#FAFAFA',
  textSecondary: '#A1A1AA',
  divider: '#27272A',
  action: '#FAFAFA',
  onAction: '#09090B',
  actionSubtle: '#27272A',
  caution: '#FBBF24',
  cautionSubtle: '#2A2006',
  danger: '#F87171',
  dangerSubtle: '#2D1213',
  success: '#3DDC97',
  successSubtle: '#0D2A1E',
  live: '#3DDC97',
  scheduled: '#D4D4D8',
  stale: '#FBBF24',
  cancelled: '#F87171',
};

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    scheme: 'light',
    colors: lightColors,
    map: {
      background: basemapInks.light.land,
      routeLine: '#09090B',
      routeCasing: '#FFFFFF',
      placeMarker: '#09090B',
      stopMarker: '#71717A',
      markerStroke: '#FFFFFF',
      selectedMarkerStroke: '#09090B',
      labelText: '#09090B',
      labelHalo: '#FFFFFF',
      userLocation: lightColors.live,
      userLocationStroke: '#FFFFFF',
      live: lightColors.live,
      caution: '#B45309',
      coverage: '#71717A',
    },
  },
  dark: {
    scheme: 'dark',
    colors: darkColors,
    map: {
      background: basemapInks.dark.land,
      routeLine: '#FFFFFF',
      routeCasing: '#000000',
      placeMarker: '#FFFFFF',
      stopMarker: '#A1A1AA',
      markerStroke: '#000000',
      selectedMarkerStroke: '#FFFFFF',
      labelText: '#F4F4F5',
      labelHalo: '#000000',
      userLocation: darkColors.live,
      userLocationStroke: '#000000',
      live: darkColors.live,
      caution: '#F5B83D',
      coverage: '#8E8E96',
    },
  },
};

export const themeColorNames = Object.keys(lightColors) as (keyof ThemeColors)[];

/** `surfaceRaised` → `surface-raised`; the suffix of the CSS variable and Tailwind colour name. */
export function kebabTokenName(name: keyof ThemeColors): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}
