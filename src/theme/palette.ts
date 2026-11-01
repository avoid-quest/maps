/**
 * Semantic colour tokens. Components describe a role (surface, secondary text, action, stale data),
 * never a hue, so each role can resolve differently in light and dark appearance.
 *
 * Every text-role token is checked against every surface in `palette.test.ts` (WCAG AA 4.5:1).
 */
export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  /** App background and task-card body. */
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
  /** Primary action fill, links, active icons and route emphasis. */
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
  /** Transit: a realtime prediction from the operator feed. */
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
  userLocation: string;
  userLocationStroke: string;
  coverage: string;
}

export interface Palette {
  scheme: ColorScheme;
  colors: ThemeColors;
  map: MapColors;
}

const lightColors: ThemeColors = {
  surface: '#FAFBFC',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#EEF1F4',
  textPrimary: '#1A1D23',
  textSecondary: '#525A66',
  divider: '#DDE1E6',
  action: '#1D5BD6',
  onAction: '#FFFFFF',
  actionSubtle: '#E6EEFC',
  caution: '#8A5000',
  cautionSubtle: '#FDF1DC',
  danger: '#B42318',
  dangerSubtle: '#FCE9E7',
  success: '#1C6B3A',
  successSubtle: '#E4F3E9',
  live: '#0C6E60',
  scheduled: '#3E4652',
  stale: '#8A5000',
  cancelled: '#B42318',
};

const darkColors: ThemeColors = {
  surface: '#16181C',
  surfaceRaised: '#1F2228',
  surfaceMuted: '#2A2E35',
  textPrimary: '#ECEEF1',
  textSecondary: '#A8AFB9',
  divider: '#353A42',
  action: '#8AB4F8',
  onAction: '#0B1B36',
  actionSubtle: '#1D2C45',
  caution: '#F0B95C',
  cautionSubtle: '#36290F',
  danger: '#F49189',
  dangerSubtle: '#3D1D1B',
  success: '#7DD3A0',
  successSubtle: '#163020',
  live: '#62D2BF',
  scheduled: '#C8CDD5',
  stale: '#F0B95C',
  cancelled: '#F49189',
};

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    scheme: 'light',
    colors: lightColors,
    map: {
      background: '#F8F4F0',
      routeLine: lightColors.action,
      routeCasing: '#FFFFFF',
      placeMarker: lightColors.action,
      stopMarker: '#A35A00',
      markerStroke: '#FFFFFF',
      selectedMarkerStroke: lightColors.textPrimary,
      labelText: lightColors.textPrimary,
      labelHalo: '#FFFFFF',
      userLocation: lightColors.action,
      userLocationStroke: '#FFFFFF',
      coverage: '#167469',
    },
  },
  dark: {
    scheme: 'dark',
    colors: darkColors,
    map: {
      background: '#1B1D21',
      routeLine: darkColors.action,
      routeCasing: '#0E1116',
      placeMarker: darkColors.action,
      stopMarker: darkColors.caution,
      markerStroke: '#0E1116',
      selectedMarkerStroke: '#FFFFFF',
      labelText: darkColors.textPrimary,
      labelHalo: '#0E1116',
      /** Saturated so the white ring reads; also distinct from place markers. */
      userLocation: '#3B82F6',
      userLocationStroke: '#FFFFFF',
      coverage: darkColors.live,
    },
  },
};

export const themeColorNames = Object.keys(lightColors) as (keyof ThemeColors)[];

/** `surfaceRaised` → `surface-raised`; the suffix of the CSS variable and Tailwind colour name. */
export function kebabTokenName(name: keyof ThemeColors): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}
