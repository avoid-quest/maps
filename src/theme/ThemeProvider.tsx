import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Appearance, Platform, View, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { vars } from 'nativewind';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { themeVariables } from './css-variables';
import { mapStyleFor, mapStyleJsonFor } from './map-style';
import { palettes, type ColorScheme, type MapColors, type ThemeColors } from './palette';
import { systemChromeFor } from './system-chrome';
import { resolveColorScheme, themePreferences, type ThemePreference, type ThemePreferenceSnapshot, type ThemePreferenceStorage, type ThemePreferenceStore } from './theme-preference';

export interface Theme {
  preference: ThemePreference;
  scheme: ColorScheme;
  colors: ThemeColors;
  map: MapColors;
  mapStyle: StyleSpecification;
  /** `mapStyle` serialized once per scheme; pass to the native `Map mapStyle` prop. */
  mapStyleJson: string;
  preferenceState: ThemePreferenceSnapshot;
  setPreference(preference: ThemePreference): Promise<boolean>;
}

function themeFor(scheme: ColorScheme, preferenceState: ThemePreferenceSnapshot, setPreference: Theme['setPreference']): Theme {
  return { preference: preferenceState.preference, scheme, colors: palettes[scheme].colors, map: palettes[scheme].map, mapStyle: mapStyleFor(scheme), mapStyleJson: mapStyleJsonFor(scheme), preferenceState, setPreference };
}

/** Outside a provider (isolated previews, tests) components render the light palette. */
const fallbackTheme = themeFor('light', { ready: false, preferenceKnown: false, preference: 'system', storage: 'unavailable' }, async () => false);
const ThemeContext = createContext<Theme>(fallbackTheme);

/**
 * Where semantic colours come from. Native: the `:root` and `prefers-color-scheme: dark` blocks in
 * global.css, which NativeWind binds to the colour scheme set through `Appearance` (SystemChrome below).
 * Every styled view subscribes to that, so a live switch repaints memoized rows and floating controls
 * too; inline `vars()` only reached views that happened to re-render. Web: inline custom properties,
 * so an in-app Chiaro/Scuro choice can override the browser preference.
 */
const schemeVariables: Partial<Record<ColorScheme, ReturnType<typeof vars>>> = {};
function variablesFor(scheme: ColorScheme) {
  if (Platform.OS !== 'web') return undefined;
  return (schemeVariables[scheme] ??= vars(themeVariables(scheme)));
}

export interface ThemeProviderProps {
  children: ReactNode;
  store?: ThemePreferenceStore;
  storage?: ThemePreferenceStorage;
  /** Apply status bar, navigation bar, root background and native appearance. Disable for nested providers. */
  systemChrome?: boolean;
}

/**
 * Resolves Sistema/Chiaro/Scuro once for the tree. Descendants use semantic NativeWind classes
 * (`bg-surface`, `text-primary`) or `useTheme()` for values native props need.
 */
export function ThemeProvider({ children, store = themePreferences, storage = AsyncStorage, systemChrome = true }: ThemeProviderProps) {
  const preferenceState = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const system = useColorScheme();
  useEffect(() => { void store.initialize(storage); }, [store, storage]);
  const scheme = resolveColorScheme(preferenceState.preference, system);
  const theme = useMemo(() => themeFor(scheme, preferenceState, store.setPreference), [scheme, preferenceState, store]);
  return <ThemeContext.Provider value={theme}>
    <View className="flex-1" style={variablesFor(scheme)}>{children}</View>
    {systemChrome ? <SystemChrome preference={preferenceState.preference} scheme={scheme} /> : null}
  </ThemeContext.Provider>;
}

function SystemChrome({ preference, scheme }: { preference: ThemePreference; scheme: ColorScheme }) {
  const chrome = systemChromeFor(preference, scheme);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(chrome.appearanceOverride);
  }, [chrome.appearanceOverride]);
  useEffect(() => () => { if (Platform.OS !== 'web') Appearance.setColorScheme(null); }, []);
  useEffect(() => {
    if (Platform.OS === 'android') NavigationBar.setStyle(chrome.navigationBarStyle);
  }, [chrome.navigationBarStyle]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(chrome.rootBackground).catch(() => undefined);
  }, [chrome.rootBackground]);
  return <StatusBar style={chrome.statusBarStyle} />;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Resolved semantic colours for icons, ActivityIndicator, Switch, placeholders and other native props. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
