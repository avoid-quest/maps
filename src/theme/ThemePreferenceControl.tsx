import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './ThemeProvider';
import { themePreferenceOptions } from './theme-preference';

/** Aspetto: Sistema / Chiaro / Scuro. Place inside settings; requires a ThemeProvider ancestor. */
export function ThemePreferenceControl() {
  const { preference, preferenceState, setPreference } = useTheme();
  const disabled = !preferenceState.ready;
  return <View className="gap-2">
    <Text className="text-base font-semibold text-primary" accessibilityRole="header">Aspetto</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Aspetto" className="flex-row rounded-xl bg-surface-muted p-1">
      {themePreferenceOptions.map(option => {
        const selected = option.value === preference;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled}
          onPress={() => { void setPreference(option.value); }}
          className={`min-h-12 flex-1 items-center justify-center rounded-lg px-2 ${selected ? 'border border-divider bg-surface-raised' : ''}`}>
          <Text className={`text-sm ${selected ? 'font-semibold text-primary' : 'text-secondary'}`}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    {preferenceState.storage === 'unavailable'
      ? <Text className="text-sm text-caution">{preferenceState.preferenceKnown ? 'Scelta attiva solo in questa sessione: non è stato possibile salvarla.' : 'Preferenza salvata non leggibile: segue il sistema finché non scegli.'}</Text>
      : null}
  </View>;
}
