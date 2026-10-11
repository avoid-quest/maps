import React, { useState, useSyncExternalStore } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { copyText } from '../platform/clipboard';
import { Button, Notice } from './Controls';
import { copyDiagnosticReport, diagnostics, MAX_DIAGNOSTIC_EVENTS } from '../services/diagnostics';
import { diagnosticReport } from '../services/diagnostics-runtime';
import { colors } from '../theme/tokens';

export function DiagnosticsPanel() {
  const snapshot = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot, diagnostics.getSnapshot);
  const [report, setReport] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
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

  return <View className="gap-3 border-y border-[#E2E8F0] py-5">
    <Text className="text-lg font-semibold text-[#17243C]">Diagnostica locale</Text>
    <Text className="text-sm leading-6 text-[#59667A]">
      Stati tecnici, tempi delle richieste e versione dell’app restano su questo dispositivo.
      Nessuna posizione, ricerca, nome di luogo o testo degli errori. Nessun invio automatico.
    </Text>
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="text-base font-semibold text-[#17243C]">Registra eventi tecnici</Text>
        <Text className="mt-1 text-sm text-[#59667A]">{!snapshot.ready ? 'Caricamento…' : !snapshot.preferenceKnown ? 'Sospesa' : snapshot.enabled ? 'Attiva' : 'Disattivata'} · {snapshot.events.length}/{MAX_DIAGNOSTIC_EVENTS} eventi</Text>
      </View>
      <Switch accessibilityLabel="Registra eventi tecnici" value={snapshot.enabled} disabled={!snapshot.ready || busy} onValueChange={enabled => void setEnabled(enabled)} trackColor={{ true: colors.blue }} />
    </View>
    <Text className="text-sm leading-5 text-[#59667A]">Il registro conserva gli ultimi 120 eventi. Gli arresti nativi e i problemi prima dell’avvio dell’app possono non comparire.</Text>
    {snapshot.ready && !snapshot.preferenceKnown ? <>
      <Notice danger text="Impossibile leggere l’impostazione salvata. La registrazione è sospesa e il registro salvato non è stato modificato. Puoi attivarla con l’interruttore o mantenerla disattivata: la scelta sostituirà il registro non leggibile con uno vuoto." />
      <Button secondary disabled={busy} onPress={() => void setEnabled(false)}>Mantieni disattivata</Button>
    </> : snapshot.storage === 'unavailable' ? <Notice danger text="Salvataggio locale non disponibile. Il report può contenere solo gli eventi di questa sessione." /> : null}
    <Button icon="document-text-outline" secondary disabled={!snapshot.ready || busy} onPress={() => { setReport(diagnosticReport()); setFeedback(''); setFailed(false); }}>
      {report === null ? 'Anteprima report' : 'Aggiorna anteprima'}
    </Button>
    {report !== null ? <>
      <Text className="text-sm leading-5 text-[#59667A]">Verrà copiato esattamente questo testo. Controllalo prima di condividerlo.</Text>
      <ScrollView className="max-h-72 rounded-xl bg-[#F3F6FA] p-3" nestedScrollEnabled accessibilityLabel="Anteprima del report diagnostico">
        <Text selectable className="text-xs leading-5 text-[#17243C]">{report}</Text>
      </ScrollView>
      <Button icon="copy-outline" disabled={busy} onPress={() => void copy()}>Copia report</Button>
    </> : null}
    <Button icon="trash-outline" secondary disabled={!snapshot.ready || !snapshot.preferenceKnown || busy} onPress={() => void clear()}>Cancella registro</Button>
    {feedback ? <View accessibilityLiveRegion="polite"><Notice text={feedback} danger={failed} /></View> : null}
  </View>;
}
