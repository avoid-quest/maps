import React from 'react';
import { View } from 'react-native';
import { Text } from '../ui/Text';
import { SegmentedControl } from '../ui/Chip';
import { useTheme } from './ThemeProvider';
import { themePreferenceOptions } from './theme-preference';

/** Aspetto: Sistema / Chiaro / Scuro. Place inside settings; requires a ThemeProvider ancestor. */
export function ThemePreferenceControl() {
  const { preference, preferenceState, setPreference } = useTheme();
  return <View className="gap-2">
    <Text className="text-base font-semibold text-primary" accessibilityRole="header">Aspetto</Text>
    <SegmentedControl accessibilityLabel="Aspetto" options={themePreferenceOptions} value={preference} disabled={!preferenceState.ready}
      onChange={value => { void setPreference(value); }} />
    {preferenceState.storage === 'unavailable'
      ? <Text accessibilityLiveRegion="polite" className="text-sm text-caution">{preferenceState.preferenceKnown ? 'Scelta attiva solo in questa sessione: non è stato possibile salvarla.' : 'Preferenza salvata non leggibile: segue il sistema finché non scegli.'}</Text>
      : null}
  </View>;
}
