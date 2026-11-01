import React, { useState, useSyncExternalStore } from 'react';
import { Switch, Text, View } from 'react-native';
import type { SearchPolicy } from '../../domain/types';
import { searchPreferences } from '../../services/search-preferences';
import { useThemeColors } from '../../theme';
import { Button, Notice } from '../../ui';

export function DiscoverySettings() {
  const snapshot = useSyncExternalStore(searchPreferences.subscribe, searchPreferences.getSnapshot, searchPreferences.getSnapshot);
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function choose(policy: SearchPolicy) {
    setBusy(true);
    const saved = await searchPreferences.setPolicy(policy);
    setFeedback(saved ? 'Salvato.' : 'Salvataggio non riuscito. Scelta attiva solo per questa sessione.');
    setBusy(false);
  }
  return <View className="gap-3 border-y border-divider py-5">
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="text-lg font-semibold text-primary">Solo ricerca locale</Text>
        <Text className="mt-1 text-sm text-secondary">{!snapshot.ready ? 'Caricamento della preferenza…' : !snapshot.preferenceKnown ? 'Attiva per precauzione' : snapshot.policy === 'local-only' ? 'Attiva' : 'Disattivata'}</Text>
      </View>
      <Switch accessibilityLabel="Solo ricerca locale" value={snapshot.policy === 'local-only'} disabled={!snapshot.ready || busy} onValueChange={local => void choose(local ? 'local-only' : 'local-and-online')} trackColor={{ true: colors.action, false: colors.surfaceMuted }} thumbColor={snapshot.policy === 'local-only' ? colors.onAction : colors.textSecondary} />
    </View>
    <Text className="text-sm leading-6 text-secondary">Attiva: cerca nel pacchetto locale, che può essere incompleto. Disattiva: invia nome e area a Photon.</Text>
    <Text className="text-sm leading-6 text-secondary">Mappe, percorsi e arrivi restano online.</Text>
    {snapshot.ready && !snapshot.preferenceKnown ? <>
      <Notice tone="danger" text="Preferenza non leggibile. Ricerca online sospesa: scegli di nuovo." />
      <Button variant="secondary" disabled={busy} onPress={() => void choose('local-only')}>Conferma solo locale</Button>
    </> : null}
    {feedback ? <View accessibilityLiveRegion="polite"><Notice text={feedback} tone={snapshot.storage === 'unavailable' ? 'danger' : 'success'} /></View> : null}
  </View>;
}
