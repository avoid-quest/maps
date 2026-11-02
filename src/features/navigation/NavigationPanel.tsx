import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from '../../ui/Text';
import { useThemeColors } from '../../theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TransitConfirmation } from '../../domain/navigation';
import { navigationLocationForReplan, navigationPresentation } from '../../domain/navigation';
import { Button, Display, Icon, IconButton, Notice, Num, useHairlines } from '../../ui';
import type { NavigationState } from './navigation-controller';
import { journeyDuration } from '../planner/journey-presentation';
import type { CameraIntent } from './guidance-camera';

const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
export function NavigationPanel({ snapshot, busy, error, following, intent, onRecenter, onOverview, onChromeLayout, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  following: boolean; intent: CameraIntent; onRecenter: () => void; onOverview: () => void;
  /** Heights of the top banner and bottom chrome, so the camera anchors the puck between them. */
  onChromeLayout: (top: number, bottom: number) => void;
  onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const { width, height, fontScale } = useWindowDimensions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const banner = useRef(120);
  const strip = useRef(190);
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
    <View testID="navigation-instruction" onLayout={event => { banner.current = event.nativeEvent.layout.height; onChromeLayout(banner.current, strip.current); }} style={{ height: Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)), ...(landscape ? { position: "absolute", top: 0, left: 0, right: 320 } as const : {}), backgroundColor: colors.chrome, ...hairlines.bottom }} className="px-4 py-3">
      <ScrollView>
        <View className="flex-row items-center gap-2">
          <View className="w-6">{waiting ? <ActivityIndicator color={colors.textPrimary} /> : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} color={colors.textPrimary} />}</View>
          {guiding && !transitMode && snapshot.distanceToManeuverMeters != null
            ? <Display accessibilityRole="header" accessibilityLiveRegion="polite" accessibilityLabel={text.header} size={34} className="flex-1 text-primary">{distance(snapshot.distanceToManeuverMeters)}</Display>
            : <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="flex-1 text-sm font-semibold text-primary">{text.header}</Text>}
        </View>
        <Text className="mt-1 text-xl font-semibold leading-7 text-primary">{text.instruction}</Text>
      </ScrollView>
    </View>
    <View pointerEvents="box-none" className="flex-1">
      <View style={{ position: "absolute", right: landscape ? 332 : 12, top: landscape ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 48 : 48 }} className="gap-2">
        <IconButton floating icon="map-outline" label="Panoramica del percorso" active={intent === 'overview'} disabled={!snapshot.route} onPress={onOverview} />
      </View>
      {intent !== 'follow' && snapshot.location ? <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 12 }} className="items-center">
        <Pressable testID="navigation-recenter" accessibilityRole="button" accessibilityLabel="Ricentra sulla mia posizione" onPress={onRecenter}
          style={[hairlines.floating, { minHeight: 48 }]} className="flex-row items-center gap-2 rounded-full px-5">
          <Icon name="navigate-outline" color={colors.textPrimary} /><Text className="text-base font-semibold text-primary">Ricentra</Text>
        </Pressable>
      </View> : null}
    </View>
    <View testID="navigation-sheet" onLayout={event => { strip.current = event.nativeEvent.layout.height; onChromeLayout(banner.current, strip.current); }} style={[landscape ? { position: "absolute", right: 0, top: 0, bottom: 0, width: 320 } : { height: panelHeight }, hairlines.top]} className="rounded-t-3xl bg-surface">
      <View className="flex-row items-center gap-3 px-4 pt-2" style={{ height: 52 }}>
        {searching && text.signal ? <Num testID="navigation-signal" accessibilityLiveRegion="polite" className="flex-1 text-base font-semibold leading-5 text-primary" numberOfLines={2}>{text.signal}</Num>
          : <Num className="flex-1 text-lg font-semibold text-primary" numberOfLines={1}>{!transit && snapshot.distanceRemainingMeters != null ? `${remainingSeconds != null ? journeyDuration(remainingSeconds) + ' · ' : ''}${distance(snapshot.distanceRemainingMeters)}` : transit ? `Tratta ${transit.legIndex + 1} di ${transit.legCount}` : 'Il tuo viaggio'}</Num>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Dettagli navigazione, ${voiceLabel}`} onPress={() => setDetailsOpen(true)} className="min-h-12 min-w-12 items-center justify-center px-2"><Text className="text-sm font-semibold text-primary underline">Dettagli</Text></Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
        {/* Only about two lines are visible above the actions: precision and warnings come first. */}
        {text.precision ? <Num testID="navigation-reduced-precision" className="text-sm font-semibold leading-5 text-caution">{text.precision}</Num> : null}
        {!searching && text.signal ? <Num testID="navigation-signal" className="text-sm font-semibold leading-5 text-primary">{text.signal}</Num> : null}
        {text.transitWarning ? <Notice tone="danger" text={text.transitWarning} /> : null}
        <Text testID="navigation-quality" accessibilityLiveRegion="polite" className="text-sm leading-5 text-secondary">{text.quality}</Text>
        {paused && snapshot.location && !transitMode ? <Text className="text-sm leading-5 text-secondary">Ultima posizione accettata: <Num className="text-sm text-secondary">{time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Num></Text> : null}
        {!terminal && snapshot.sessionId && !snapshot.notificationGranted ? <Notice text="Notifiche disattivate: nessun controllo nella barra delle notifiche. Interrompi la guida da qui." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
        {!terminal && snapshot.sessionId && snapshot.voice === 'unavailable' ? <Text testID="navigation-voice" className="text-sm leading-5 text-secondary">Solo indicazioni visive: nessuna voce italiana offline installata.</Text> : null}
        {snapshot.problem === 'location-permission' ? <Button variant="secondary" onPress={() => { void Linking.openSettings(); }}>Apri impostazioni</Button> : null}
        {error ? <Notice tone="danger" text={error} /> : null}
      {transit ? <Text className="text-sm leading-5 text-secondary">{transit.line ? `${transit.line} · ` : ''}{transit.timingStatus === 'prediction' ? 'Previsioni' : transit.timingStatus === 'scheduled' ? 'Da orario' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Orari non disponibili'} · consultato {time(transit.fetchedAt)}{transitAge >= 2 ? ` · consultato ${transitAge} min fa, da aggiornare` : ''}</Text> : null}
      {snapshot.mode === 'transit' && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2 || text.transitWarning) ? <Button variant="secondary" icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Scegli la partenza'}</Button> : null}
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
        {guiding && cues && snapshot.distanceToManeuverMeters != null ? <Text className="text-sm text-secondary">Distanza dal punto da raggiungere in linea d’aria: {distance(snapshot.distanceToManeuverMeters)}.</Text> : null}
        {transit.proximityAvailable === false ? <Notice text="Vicinanza non disponibile. Conferma la fermata manualmente." /> : null}
        {(transit.phase === 'walk' || transit.phase === 'transfer') ? <Text className="text-sm leading-5 text-secondary">Tratta a piedi senza indicazioni di svolta.</Text> : null}
        {!terminal && !cues ? <Notice text="Avvisi di vicinanza sospesi senza una posizione precisa. Conferma salita e discesa manualmente." /> : null}
      </View> : null}
            {snapshot.nextInstruction ? <Text className="text-sm leading-5 text-secondary">Poi: {snapshot.nextInstruction}</Text> : null}
            {snapshot.location ? <Text className="text-sm leading-5 text-secondary">Ultima posizione accettata: {time(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Text> : null}
            {!terminal && snapshot.sessionId ? <>
              <Text className="text-sm leading-5 text-secondary">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Installa una voce italiana offline per la guida vocale.'}</Text>
              {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <Button variant="secondary" icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</Button> : null}
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
