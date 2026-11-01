import React, { useState, useSyncExternalStore } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Text } from '../../ui/Text';
import { copyText } from '../../platform/clipboard';
import { useThemeColors } from '../../theme';
import { Button, Notice, useHairlines } from '../../ui';
import { copyDiagnosticReport, diagnostics, MAX_DIAGNOSTIC_EVENTS } from '../../services/diagnostics';
import { diagnosticReport } from '../../services/diagnostics-runtime';

export function DiagnosticsPanel() {
  const snapshot = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot, diagnostics.getSnapshot);
  const [report, setReport] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    const persisted = await diagnostics.setEnabled(enabled);
    setFailed(!persisted);
    setFeedback(persisted ? enabled ? 'Registrazione attivata.' : 'Registrazione disattivata. Puoi cancellare gli eventi già salvati.' : 'Impostazione valida solo per questa sessione: salvataggio sul dispositivo non riuscito.');
    if (report !== null) setReport(diagnosticReport());
    setBusy(false);
  }
  async function clear() {
    setBusy(true);
    const persisted = await diagnostics.clear();
    setFailed(!persisted);
    setFeedback(persisted ? 'Registro cancellato. Gli eventuali nuovi eventi saranno registrati se la diagnostica è attiva.' : 'Registro svuotato in memoria, ma cancellazione sul dispositivo non riuscita. Riprova.');
    if (report !== null) setReport(diagnosticReport());
    setBusy(false);
  }
  async function copy() {
    if (report === null) return;
    setBusy(true);
    const result = await copyDiagnosticReport(report, copyText);
    diagnostics.record({ type: 'clipboard', state: result });
    setFailed(result === 'failed');
    setFeedback(result === 'copied' ? 'Report copiato. Incollalo nel messaggio di feedback.' : 'Copia non riuscita. Riprova oppure seleziona e copia il testo dell’anteprima.');
    setBusy(false);
  }

  return <View style={[hairlines.top, hairlines.bottom]} className="gap-3 py-5">
    <Text className="text-base font-semibold text-primary">Diagnostica locale</Text>
    <Text className="text-sm leading-6 text-secondary">
      Stati tecnici, tempi delle richieste e versione dell’app restano su questo dispositivo.
      Nessuna posizione, ricerca, nome di luogo o testo degli errori. Nessun invio automatico.
    </Text>
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="text-base font-semibold text-primary">Registra eventi tecnici</Text>
        <Text className="mt-1 text-sm text-secondary">{!snapshot.ready ? 'Caricamento…' : !snapshot.preferenceKnown ? 'Sospesa' : snapshot.enabled ? 'Attiva' : 'Disattivata'} · {snapshot.events.length}/{MAX_DIAGNOSTIC_EVENTS} eventi</Text>
      </View>
      <Switch accessibilityLabel="Registra eventi tecnici" value={snapshot.enabled} disabled={!snapshot.ready || busy} onValueChange={enabled => void setEnabled(enabled)} trackColor={{ true: colors.action, false: colors.surfaceMuted }} thumbColor={snapshot.enabled ? colors.onAction : colors.textSecondary} />
    </View>
    <Text className="text-sm leading-5 text-secondary">Il registro conserva gli ultimi 120 eventi. Gli arresti nativi e i problemi prima dell’avvio dell’app possono non comparire.</Text>
    {snapshot.ready && !snapshot.preferenceKnown ? <>
      <Notice tone="danger" text="Impossibile leggere l’impostazione salvata. La registrazione è sospesa e il registro salvato non è stato modificato. Puoi attivarla con l’interruttore o mantenerla disattivata: la scelta sostituirà il registro non leggibile con uno vuoto." />
      <Button variant="secondary" disabled={busy} onPress={() => void setEnabled(false)}>Mantieni disattivata</Button>
    </> : snapshot.storage === 'unavailable' ? <Notice tone="danger" text="Salvataggio locale non disponibile. Il report può contenere solo gli eventi di questa sessione." /> : null}
    <Button icon="document-text-outline" variant="secondary" disabled={!snapshot.ready || busy} onPress={() => { setReport(diagnosticReport()); setFeedback(''); setFailed(false); }}>
      {report === null ? 'Anteprima report' : 'Aggiorna anteprima'}
    </Button>
    {report !== null ? <>
      <Text className="text-sm leading-5 text-secondary">Verrà copiato esattamente questo testo. Controllalo prima di condividerlo.</Text>
      <ScrollView className="max-h-72 rounded-xl bg-surface-muted p-3" nestedScrollEnabled accessibilityLabel="Anteprima del report diagnostico">
        <Text selectable className="font-mono text-sm leading-5 text-primary">{report}</Text>
      </ScrollView>
      <Button icon="copy-outline" disabled={busy} onPress={() => void copy()}>Copia report</Button>
    </> : null}
    <Button icon="trash-outline" variant="secondary" disabled={!snapshot.ready || !snapshot.preferenceKnown || busy} onPress={() => void clear()}>Cancella registro</Button>
    {feedback ? <View accessibilityLiveRegion="polite"><Notice text={feedback} tone={failed ? "danger" : "success"} /></View> : null}
  </View>;
}
