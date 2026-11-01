import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TransitConfirmation } from '../domain/navigation';
import { navigationLocationForReplan, navigationPresentation } from '../domain/navigation';
import { Button, Icon, IconButton, Notice } from './Controls';
import type { NavigationState } from './navigation-controller';
import { journeyDuration } from './journey-presentation';

const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
function NavigationButton({ children, icon, onPress, secondary = false, disabled = false, loading = false }: ComponentProps<typeof Button>) {
  const color = secondary ? '#2359D7' : 'white';
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress}
    className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-3 py-3 ${secondary ? 'bg-[#ECF2FF]' : 'bg-[#2359D7]'} ${disabled ? 'opacity-40' : ''}`}>
    {loading ? <ActivityIndicator color={color} /> : icon ? <Icon name={icon} size={20} color={color} /> : null}
    <Text className={`shrink text-center text-base font-semibold ${secondary ? 'text-[#2359D7]' : 'text-white'}`}>{children}</Text>
  </Pressable>;
}

export function NavigationPanel({ snapshot, busy, error, following, onRecenter, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  following: boolean; onRecenter: () => void; onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const { width, height, fontScale } = useWindowDimensions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const transitMode = snapshot.mode === 'transit';
  const cues = snapshot.locationUsable === true;
  const waiting = busy === 'start' || snapshot.status === 'waiting-for-fix' || snapshot.status === 'routing' || snapshot.status === 'rerouting';
  const remainingSeconds = snapshot.mode !== 'transit' ? snapshot.durationRemainingSeconds : undefined;
  const arrival = remainingSeconds != null && snapshot.location ? new Date(snapshot.location.timestamp + remainingSeconds * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null;
  const text = navigationPresentation(snapshot, now, arrival, busy === 'start');
  const { terminal, guiding, paused, searching } = text;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), searching ? 1_000 : 15_000); return () => clearInterval(timer); }, [searching]);
  const transit = snapshot.transit;
  const time = (value: number) => new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const transitAge = transit ? Math.max(0, Math.floor((now - transit.fetchedAt) / 60_000)) : 0;
  const replanLocation = navigationLocationForReplan(snapshot);
  const confirmation: TransitConfirmation | undefined = transit?.canConfirmWalking ? 'walk-complete' : transit?.canConfirmBoarding ? 'board' : transit?.canConfirmAlighting ? 'alight' : undefined;
  const voiceLabel = snapshot.voice === 'ready' ? 'Voce attiva' : snapshot.voice === 'muted' ? 'Voce disattivata' : snapshot.voice === 'initializing' ? 'Preparazione voce' : 'Voce non disponibile';
  const source = snapshot.route?.source ?? (snapshot.mode === 'transit' ? 'MATO / 5T' : 'FOSSGIS / OpenStreetMap');
  const landscape = width >= 650 && height < 500;
  const panelHeight = Math.min(height * 0.46, Math.max(176, 176 * Math.min(fontScale, 1.5)));
  return <View pointerEvents="box-none" className="flex-1">
    <View testID="navigation-instruction" style={{ height: Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)), ...(landscape ? { position: "absolute", top: 0, left: 0, right: 320 } as const : {}) }} className="bg-[#17243C] px-4 py-3">
      <ScrollView>
        <View className="flex-row items-center gap-2">
          <View className="w-6">{waiting ? <ActivityIndicator color="white" /> : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} color="white" />}</View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="flex-1 text-sm font-semibold text-white">{text.header}</Text>
        </View>
        <Text className="mt-2 text-xl font-semibold leading-7 text-white">{text.instruction}</Text>
      </ScrollView>
    </View>
    <View pointerEvents="box-none" className="flex-1">
      <View style={{ position: "absolute", right: landscape ? 332 : 12, top: landscape ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 48 : 48 }}>
        <IconButton icon="locate-outline" label="Ricentra sulla mia posizione" active={following} disabled={!snapshot.location} onPress={onRecenter} />
      </View>
    </View>
    <View testID="navigation-sheet" style={landscape ? { position: "absolute", right: 0, top: 0, bottom: 0, width: 320 } : { height: panelHeight }} className="rounded-t-3xl border-t border-[#E2E8F0] bg-white">
      <View className="flex-row items-center gap-3 px-4 pt-2" style={{ height: 52 }}>
        {searching && text.signal ? <Text testID="navigation-signal" accessibilityLiveRegion="polite" className="flex-1 text-base font-semibold leading-5 text-[#17243C]" numberOfLines={2}>{text.signal}</Text>
          : <Text className="flex-1 text-lg font-semibold text-[#17243C]" numberOfLines={1}>{!transit && snapshot.distanceRemainingMeters != null ? `${remainingSeconds != null ? journeyDuration(remainingSeconds) + ' · ' : ''}${distance(snapshot.distanceRemainingMeters)}` : transit ? `Tratta ${transit.legIndex + 1} di ${transit.legCount}` : 'Il tuo viaggio'}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Dettagli navigazione, ${voiceLabel}`} onPress={() => setDetailsOpen(true)} className="min-h-12 min-w-12 items-center justify-center px-2"><Text className="text-sm font-semibold text-[#2359D7]">Dettagli</Text></Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
        {/* Only about two lines are visible above the actions: precision and warnings come first. */}
        {text.precision ? <Text testID="navigation-reduced-precision" className="text-sm font-semibold leading-5 text-[#8A5A00]">{text.precision}</Text> : null}
        {!searching && text.signal ? <Text testID="navigation-signal" className="text-sm font-semibold leading-5 text-[#17243C]">{text.signal}</Text> : null}
        {text.transitWarning ? <Notice danger text={text.transitWarning} /> : null}
        <Text testID="navigation-quality" accessibilityLiveRegion="polite" className="text-sm leading-5 text-[#59667A]">{text.quality}</Text>
        {paused && snapshot.location && !transitMode ? <Text className="text-xs leading-4 text-[#59667A]">Ultima posizione accettata: {time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Text> : null}
        {!terminal && snapshot.sessionId && !snapshot.notificationGranted ? <Notice text="Notifiche disattivate: nessun controllo nella barra delle notifiche. Interrompi la guida da qui." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
        {!terminal && snapshot.sessionId && snapshot.voice === 'unavailable' ? <Text testID="navigation-voice" className="text-xs leading-4 text-[#59667A]">Solo indicazioni visive: nessuna voce italiana offline installata.</Text> : null}
        {snapshot.problem === 'location-permission' ? <NavigationButton secondary onPress={() => { void Linking.openSettings(); }}>Apri impostazioni</NavigationButton> : null}
        {error ? <Notice danger text={error} /> : null}
      {transit ? <Text className="text-xs leading-4 text-[#59667A]">{transit.line ? `${transit.line} · ` : ''}{transit.timingStatus === 'prediction' ? 'Previsioni' : transit.timingStatus === 'scheduled' ? 'Da orario' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Orari non disponibili'} · consultato {time(transit.fetchedAt)}{transitAge >= 2 ? ` · consultato ${transitAge} min fa, da aggiornare` : ''}</Text> : null}
      {snapshot.mode === 'transit' && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2 || text.transitWarning) ? <NavigationButton secondary icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Scegli la partenza'}</NavigationButton> : null}
      {snapshot.status === 'arrived' ? <Text className="text-base leading-6 text-[#17243C]">Guida terminata. Verifica l’ingresso sul posto.</Text> : null}
      {snapshot.status === 'arrived' && snapshot.destinationDistanceMeters != null && snapshot.destinationDistanceMeters > 30 ? <Text className="text-sm leading-5 text-[#59667A]">La destinazione dista ancora {distance(snapshot.destinationDistanceMeters)} in linea d’aria.</Text> : null}
      </ScrollView>
      <View className="border-t border-[#E2E8F0] px-4 pb-3 pt-2">
        <View className="flex-row gap-2">
          <View className="min-w-0 flex-1">{!terminal && confirmation ? <NavigationButton secondary disabled={!!busy} onPress={() => onConfirmTransit(confirmation)}>{confirmation === 'board' ? 'Sono a bordo' : confirmation === 'alight' ? 'Sono sceso' : 'Sono arrivato'}</NavigationButton> : <NavigationButton secondary icon="refresh-outline" loading={busy === 'retry'} disabled={!!busy || !snapshot.canRetry} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi' : 'Riprova'}</NavigationButton>}</View>
          <View className="min-w-0 flex-1"><NavigationButton icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi' : 'Interrompi'}</NavigationButton></View>
        </View>
      </View>
    </View>
    <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
      <View className="flex-1 justify-end bg-black/40">
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal className="max-h-[80%] rounded-t-3xl bg-white">
          <View className="flex-row items-center justify-between border-b border-[#E2E8F0] px-4 py-2">
            <Text accessibilityRole="header" className="mr-2 flex-1 text-lg font-semibold text-[#17243C]">Dettagli navigazione</Text>
            <IconButton icon="close-outline" label="Chiudi dettagli" onPress={() => setDetailsOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      {transit ? <View className="gap-2">
        <Text className="text-base font-semibold text-[#17243C]">{transit.line ?? ((transit.phase === 'walk' || transit.phase === 'transfer') ? 'A piedi' : 'Mezzo pubblico')}{transit.headsign ? ` verso ${transit.headsign}` : ''}</Text>
        {transit.from || transit.to ? <Text className="text-sm leading-5 text-[#59667A]">{transit.from ?? 'Partenza'} → {transit.to ?? 'Destinazione'}</Text> : null}
        <Text className="text-sm leading-5 text-[#59667A]">{transit.timingStatus === 'scheduled' ? 'Orari programmati' : transit.timingStatus === 'prediction' ? 'Previsioni consultate' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Stato della corsa non disponibile'}{transit.departureAt ? ` · partenza ${time(transit.departureAt)}` : ''}{transit.arrivalAt ? ` · arrivo ${time(transit.arrivalAt)}` : ''}. Dati consultati {transitAge < 1 ? 'meno di un minuto fa' : `${transitAge} min fa`}.</Text>
        {transitAge >= 2 ? <Notice text="Dati da aggiornare. Corse non monitorate durante la guida." /> : null}
        {guiding && cues && snapshot.distanceToManeuverMeters != null ? <Text className="text-sm text-[#59667A]">Distanza dal punto da raggiungere in linea d’aria: {distance(snapshot.distanceToManeuverMeters)}.</Text> : null}
        {transit.proximityAvailable === false ? <Notice text="Vicinanza non disponibile. Conferma la fermata manualmente." /> : null}
        {(transit.phase === 'walk' || transit.phase === 'transfer') ? <Text className="text-sm leading-5 text-[#59667A]">Tratta a piedi senza indicazioni di svolta.</Text> : null}
        {!terminal && !cues ? <Notice text="Avvisi di vicinanza sospesi senza una posizione precisa. Conferma salita e discesa manualmente." /> : null}
      </View> : null}
            {snapshot.nextInstruction ? <Text className="text-sm leading-5 text-[#59667A]">Poi: {snapshot.nextInstruction}</Text> : null}
            {snapshot.location ? <Text className="text-sm leading-5 text-[#59667A]">Ultima posizione accettata: {time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Text> : null}
            {!terminal && snapshot.sessionId ? <>
              <Text className="text-sm leading-5 text-[#59667A]">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Installa una voce italiana offline per la guida vocale.'}</Text>
              {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <NavigationButton secondary icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</NavigationButton> : null}
            </> : null}
            <Text className="text-sm leading-5 text-[#59667A]">{source}. {snapshot.mode === 'transit' ? 'La posizione non conferma la presenza a bordo: conferma salita e discesa.' : 'Stime senza traffico in tempo reale.'} {snapshot.route ? `Percorso consultato alle ${time(snapshot.route.fetchedAt)}.` : ''}</Text>
            <Text className="text-sm leading-5 text-[#59667A]">La guida può continuare con lo schermo spento finché Android mantiene la sessione attiva.</Text>
          </ScrollView>
          <View className="px-4 pb-3 pt-2"><NavigationButton secondary icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi navigazione' : 'Interrompi navigazione'}</NavigationButton></View>
        </SafeAreaView>
      </View>
    </Modal>
  </View>;
}
