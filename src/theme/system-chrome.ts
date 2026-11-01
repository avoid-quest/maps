import { palettes, type ColorScheme } from './palette';
import type { ThemePreference } from './theme-preference';

/**
 * Android system UI for a resolved appearance. The Expo modules name these styles differently:
 * expo-status-bar `light` means light icons, expo-navigation-bar `dark` means a dark bar with light icons.
 */
export function systemChromeFor(preference: ThemePreference, scheme: ColorScheme) {
  return {
    /** For `Appearance.setColorScheme`: null follows the system; a choice also themes native dialogs. */
    appearanceOverride: preference === 'system' ? null : preference,
    statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
    navigationBarStyle: scheme,
    /** Root window colour shown behind edge-to-edge content and before the first frame paints. */
    rootBackground: palettes[scheme].colors.chrome,
  } as const;
}
