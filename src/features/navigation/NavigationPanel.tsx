import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from '../../ui/Text';
import { useThemeColors } from '../../theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NavigationSnapshot, TransitConfirmation } from '../../domain/navigation';
import { navigationLocationForReplan } from '../../domain/navigation';
import { Button, Display, Icon, IconButton, Notice, Num, useHairlines } from '../../ui';
import type { NavigationState } from './navigation-controller';
import { journeyDuration } from '../planner/journey-presentation';

const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
const statuses: Record<NavigationSnapshot['status'], string> = {
  idle: 'Preparazione', 'waiting-for-fix': 'Ricerca della posizione precisa', routing: 'Calcolo dalla tua posizione',
  navigating: 'Navigazione', 'location-degraded': 'Posizione da ritrovare', 'off-route': 'Fuori percorso', rerouting: 'Ricalcolo del percorso',
  arrived: 'Sei arrivato', stopped: 'Navigazione terminata', interrupted: 'Navigazione interrotta', error: 'Navigazione non disponibile',
};
const problems: Record<NonNullable<NavigationSnapshot['problem']>, string> = {
  'location-permission': 'La posizione precisa non è autorizzata. Abilitala nelle impostazioni dell’app.',
  'location-disabled': 'La posizione del dispositivo è disattivata. Riattivala per proseguire.',
  'location-stale': 'Posizione non aggiornata.',
  'location-inaccurate': 'Posizione poco precisa.',
  'route-unavailable': 'Percorso non disponibile. Controlla la connessione.',
  'rate-limit': 'Troppe richieste. Riprova più tardi.',
  'reroute-limit': 'Ricalcolo automatico sospeso. Controlla la posizione e riprova.',
  'native-error': 'La navigazione si è interrotta. Riprova dalla tua posizione attuale.',
  'transit-replan-needed': 'Viaggio da aggiornare. Scegli un nuovo percorso.',
  'engine-unavailable': 'Il motore di navigazione non è disponibile. Interrompi la sessione e riapri l’app.',
  'service-unavailable': 'Android non ha avviato il servizio di navigazione. Mantieni l’app visibile e riprova.',
};
export function NavigationPanel({ snapshot, busy, error, following, onRecenter, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  following: boolean; onRecenter: () => void; onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const { width, height, fontScale } = useWindowDimensions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  const terminal = snapshot.status === 'arrived' || snapshot.status === 'interrupted' || snapshot.status === 'error';
  const guiding = snapshot.status === 'navigating' && snapshot.locationUsable !== false;
  const waiting = busy === 'start' || snapshot.status === 'waiting-for-fix' || snapshot.status === 'routing' || snapshot.status === 'rerouting';
  const remainingSeconds = snapshot.mode !== 'transit' ? snapshot.durationRemainingSeconds : undefined;
  const arrival = remainingSeconds != null && snapshot.location ? new Date(snapshot.location.timestamp + remainingSeconds * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null;
  const transit = snapshot.transit;
  const time = (value: number) => new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const transitAge = transit ? Math.max(0, Math.floor((now - transit.fetchedAt) / 60_000)) : 0;
  const replanLocation = navigationLocationForReplan(snapshot);
  const confirmation: TransitConfirmation | undefined = transit?.canConfirmWalking ? 'walk-complete' : transit?.canConfirmBoarding ? 'board' : transit?.canConfirmAlighting ? 'alight' : undefined;
  const voiceLabel = snapshot.voice === 'ready' ? 'Voce attiva' : snapshot.voice === 'muted' ? 'Voce disattivata' : snapshot.voice === 'initializing' ? 'Preparazione voce' : 'Voce non disponibile';
  const source = snapshot.route?.source ?? (snapshot.mode === 'transit' ? 'MATO / 5T' : 'FOSSGIS / OpenStreetMap');
  const paused = !guiding && !terminal;
  const landscape = width >= 650 && height < 500;
  const panelHeight = Math.min(height * 0.46, Math.max(176, 176 * Math.min(fontScale, 1.5)));
  return <View pointerEvents="box-none" className="flex-1">
    <View testID="navigation-instruction" style={{ height: Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)), ...(landscape ? { position: "absolute", top: 0, left: 0, right: 320 } as const : {}), backgroundColor: colors.chrome, ...hairlines.bottom }} className="px-4 py-3">
      <ScrollView>
        <View className="flex-row items-center gap-2">
          <View className="w-6">{waiting ? <ActivityIndicator color={colors.textPrimary} /> : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} color={colors.textPrimary} />}</View>
          {guiding && !paused && snapshot.distanceToManeuverMeters != null
            ? <Display accessibilityRole="header" accessibilityLiveRegion="polite" accessibilityLabel={`Tra ${distance(snapshot.distanceToManeuverMeters)}`} size={34} className="flex-1 text-primary">{distance(snapshot.distanceToManeuverMeters)}</Display>
            : <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="flex-1 text-sm font-semibold text-primary">{paused && snapshot.instruction ? 'Guida in pausa · Ultima indicazione' : statuses[snapshot.status]}</Text>}
        </View>
        <Text className="mt-1 text-xl font-semibold leading-7 text-primary">{terminal ? statuses[snapshot.status] : snapshot.instruction ?? (waiting ? 'Attendi la posizione precisa' : 'In attesa di indicazioni')}</Text>
      </ScrollView>
    </View>
    <View pointerEvents="box-none" className="flex-1">
      <View style={{ position: "absolute", right: landscape ? 332 : 12, top: landscape ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 48 : 48 }}>
        <IconButton floating icon="locate-outline" label="Ricentra sulla mia posizione" active={following} disabled={!snapshot.location} onPress={onRecenter} />
      </View>
    </View>
    <View testID="navigation-sheet" style={[landscape ? { position: "absolute", right: 0, top: 0, bottom: 0, width: 320 } : { height: panelHeight }, hairlines.top]} className="rounded-t-3xl bg-surface">
      <View className="flex-row items-center gap-3 px-4 pt-2" style={{ height: 52 }}>
        <Num className="flex-1 text-lg font-semibold text-primary" numberOfLines={1}>{!transit && snapshot.distanceRemainingMeters != null ? `${remainingSeconds != null ? journeyDuration(remainingSeconds) + ' · ' : ''}${distance(snapshot.distanceRemainingMeters)}` : transit ? `Tratta ${transit.legIndex + 1} di ${transit.legCount}` : 'Il tuo viaggio'}</Num>
        <Pressable accessibilityRole="button" accessibilityLabel={`Dettagli navigazione, ${voiceLabel}`} onPress={() => setDetailsOpen(true)} className="min-h-12 min-w-12 items-center justify-center px-2"><Text className="text-sm font-semibold text-primary underline">Dettagli</Text></Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
        <Text testID="navigation-quality" accessibilityLiveRegion="polite" className="text-sm leading-5 text-secondary">{snapshot.problem ? problems[snapshot.problem] : guiding ? arrival ? `Arrivo stimato ${arrival}` : 'Posizione valida' : statuses[snapshot.status]}</Text>
        {paused && snapshot.location ? <Text className="text-sm leading-5 text-secondary">Ultima posizione accettata: <Num className="text-sm text-secondary">{time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Num></Text> : null}
        {snapshot.problem === 'location-permission' ? <Button variant="secondary" onPress={() => { void Linking.openSettings(); }}>Apri impostazioni</Button> : null}
        {error ? <Notice tone="danger" text={error} /> : null}
      {transit ? <Text className="text-sm leading-5 text-secondary">{transit.line ? `${transit.line} · ` : ''}{transit.timingStatus === 'prediction' ? 'Previsioni' : transit.timingStatus === 'scheduled' ? 'Da orario' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Orari non disponibili'} · consultato {time(transit.fetchedAt)}{transitAge >= 2 ? ' · Da aggiornare' : ''}</Text> : null}
      {snapshot.mode === 'transit' && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2) ? <Button variant="secondary" icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Scegli la partenza'}</Button> : null}
      {snapshot.status === 'arrived' ? <Text className="text-base leading-6 text-primary">Guida terminata. Verifica l’ingresso sul posto.</Text> : null}
      {snapshot.status === 'arrived' && snapshot.destinationDistanceMeters != null && snapshot.destinationDistanceMeters > 30 ? <Text className="text-sm leading-5 text-secondary">La destinazione dista ancora {distance(snapshot.destinationDistanceMeters)} in linea d’aria.</Text> : null}
      </ScrollView>
      <View style={hairlines.top} className="px-4 pb-3 pt-2">
        <View className="flex-row gap-2">
          <View className="min-w-0 flex-1">{!terminal && confirmation ? <Button variant="secondary" disabled={!!busy} onPress={() => onConfirmTransit(confirmation)}>{confirmation === 'board' ? 'Sono a bordo' : confirmation === 'alight' ? 'Sono sceso' : 'Sono arrivato'}</Button> : <Button variant="secondary" icon="refresh-outline" loading={busy === 'retry'} disabled={!!busy || !snapshot.canRetry} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi' : 'Riprova'}</Button>}</View>
          <View className="min-w-0 flex-1"><Button icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi' : 'Interrompi'}</Button></View>
        </View>
      </View>
    </View>
    <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
      <View style={{ backgroundColor: "rgba(0,0,0,0.45)" }} className="flex-1 justify-end">
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal className="max-h-[80%] rounded-t-3xl bg-surface">
          <View style={hairlines.bottom} className="flex-row items-center justify-between px-4 py-2">
            <Text accessibilityRole="header" className="mr-2 flex-1 text-lg font-semibold text-primary">Dettagli navigazione</Text>
            <IconButton icon="close-outline" label="Chiudi dettagli" onPress={() => setDetailsOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      {transit ? <View className="gap-2">
        <Text className="text-base font-semibold text-primary">{transit.line ?? ((transit.phase === 'walk' || transit.phase === 'transfer') ? 'A piedi' : 'Mezzo pubblico')}{transit.headsign ? ` verso ${transit.headsign}` : ''}</Text>
        {transit.from || transit.to ? <Text className="text-sm leading-5 text-secondary">{transit.from ?? 'Partenza'} → {transit.to ?? 'Destinazione'}</Text> : null}
        <Text className="text-sm leading-5 text-secondary">{transit.timingStatus === 'scheduled' ? 'Orari programmati' : transit.timingStatus === 'prediction' ? 'Previsioni consultate' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Stato della corsa non disponibile'}{transit.departureAt ? ` · partenza ${time(transit.departureAt)}` : ''}{transit.arrivalAt ? ` · arrivo ${time(transit.arrivalAt)}` : ''}. Dati consultati {transitAge < 1 ? 'meno di un minuto fa' : `${transitAge} min fa`}.</Text>
        {transitAge >= 2 ? <Notice text="Dati da aggiornare. Corse non monitorate durante la guida." /> : null}
        {guiding && snapshot.distanceToManeuverMeters != null ? <Text className="text-sm text-secondary">Distanza dal punto da raggiungere in linea d’aria: {distance(snapshot.distanceToManeuverMeters)}.</Text> : null}
        {transit.proximityAvailable === false ? <Notice text="Vicinanza non disponibile. Conferma la fermata manualmente." /> : null}
        {(transit.phase === 'walk' || transit.phase === 'transfer') ? <Text className="text-sm leading-5 text-secondary">Tratta a piedi senza indicazioni di svolta.</Text> : null}
        {!terminal && !guiding ? <Notice text="Avvisi di vicinanza sospesi. Conferma salita e discesa manualmente." /> : null}
      </View> : null}
            {snapshot.nextInstruction ? <Text className="text-sm leading-5 text-secondary">Poi: {snapshot.nextInstruction}</Text> : null}
            {snapshot.location ? <Text className="text-sm leading-5 text-secondary">Ultima posizione accettata: {time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Text> : null}
            {!terminal && snapshot.sessionId ? <>
              <Text className="text-sm leading-5 text-secondary">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Installa una voce italiana offline per la guida vocale.'}</Text>
              {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <Button variant="secondary" icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</Button> : null}
              {!snapshot.notificationGranted ? <Notice text="Notifiche disattivate. Torna nell’app per interrompere la guida." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
            </> : null}
            <Text className="text-sm leading-5 text-secondary">{source}. {snapshot.mode === 'transit' ? 'La posizione non conferma la presenza a bordo: conferma salita e discesa.' : 'Stime senza traffico in tempo reale.'} {snapshot.route ? `Percorso consultato alle ${time(snapshot.route.fetchedAt)}.` : ''}</Text>
            <Text className="text-sm leading-5 text-secondary">La guida può continuare con lo schermo spento finché Android mantiene la sessione attiva.</Text>
          </ScrollView>
          <View className="px-4 pb-3 pt-2"><Button variant="secondary" icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi navigazione' : 'Interrompi navigazione'}</Button></View>
        </SafeAreaView>
      </View>
    </Modal>
  </View>;
}
