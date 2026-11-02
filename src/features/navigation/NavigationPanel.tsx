import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '../../theme';
import type { TransitConfirmation } from '../../domain/navigation';
import { navigationLocationForReplan, navigationPresentation } from '../../domain/navigation';
import { Button, Display, Icon, IconButton, Notice, Num, Text, useHairlines } from '../../ui';
import { PressableSurface } from '../../ui/PressableSurface';
import { journeyDuration } from '../planner/journey-presentation';
import type { CameraIntent } from './guidance-camera';
import { bannerDistance, maneuverGlyph, maneuverLines, thenManeuver } from './maneuver-presentation';
import { ManeuverGlyphImage } from './ManeuverGlyphImage';
import type { NavigationState } from './navigation-controller';

const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
const clock = (value: number) => new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

/**
 * Road guidance: a flush maneuver banner on top, the map, and a compact bottom strip (arrival,
 * remaining time/distance, voice, overview, Interrompi). Status lives in a reserved row, so position
 * quality, rerouting and pauses never move the banner, the strip or the camera's anchor.
 */
export function NavigationPanel({ snapshot, busy, error, intent, onRecenter, onOverview, onChromeLayout, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  following: boolean; intent: CameraIntent; onRecenter: () => void; onOverview: () => void;
  /** Heights of the banner and the bottom strip, so the camera anchors the puck between them. */
  onChromeLayout: (top: number, bottom: number) => void;
  onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const { width, height, fontScale } = useWindowDimensions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const banner = useRef(0);
  const strip = useRef(0);
  const [stripHeight, setStripHeight] = useState(0);
  const transitMode = snapshot.mode === 'transit';
  const waiting = busy === 'start' || snapshot.status === 'waiting-for-fix' || snapshot.status === 'routing' || snapshot.status === 'rerouting';
  const remainingSeconds = !transitMode ? snapshot.durationRemainingSeconds : undefined;
  const text0 = navigationPresentation(snapshot, now, null, busy === 'start');
  // Only a current fix advances the estimate; a paused position never shows an apparently current ETA.
  const arrival = remainingSeconds != null && snapshot.location && text0.guiding ? clock(snapshot.location.timestamp + remainingSeconds * 1000) : null;
  const text = navigationPresentation(snapshot, now, arrival, busy === 'start');
  const { terminal, guiding, paused, searching } = text;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), searching ? 1_000 : 15_000); return () => clearInterval(timer); }, [searching]);
  const transit = snapshot.transit;
  const transitAge = transit ? Math.max(0, Math.floor((now - transit.fetchedAt) / 60_000)) : 0;
  const replanLocation = navigationLocationForReplan(snapshot);
  const confirmation: TransitConfirmation | undefined = transit?.canConfirmWalking ? 'walk-complete' : transit?.canConfirmBoarding ? 'board' : transit?.canConfirmAlighting ? 'alight' : undefined;
  const source = snapshot.route?.source ?? (transitMode ? 'MATO / 5T' : 'FOSSGIS / OpenStreetMap');
  const landscape = width >= 650 && height < 500;
  const report = () => onChromeLayout(banner.current, strip.current);

  // Banner content: the upcoming maneuver while there is one (kept, labelled, while paused).
  const maneuver = snapshot.upcomingManeuver;
  const showManeuver = !terminal && !searching && (snapshot.status === 'navigating' || snapshot.status === 'off-route' || paused) && !!(maneuver ?? snapshot.instruction);
  const glyph = maneuverGlyph(maneuver);
  const lines = maneuverLines(maneuver, snapshot.instruction);
  const meters = guiding && snapshot.distanceToManeuverMeters != null ? bannerDistance(snapshot.distanceToManeuverMeters) : null;
  const then = showManeuver && !paused ? thenManeuver(snapshot) : null;
  const status = snapshot.status === 'rerouting' ? 'Ricalcolo del percorso…' : snapshot.status === 'off-route' ? 'Fuori percorso · ricalcolo se prosegui'
    : paused ? 'Guida in pausa · Ultima indicazione' : searching ? text.signal : text.precision;
  const statusTone = paused || snapshot.status === 'off-route' || (!searching && text.precision) ? 'text-caution' : 'text-secondary';
  const problem = snapshot.problem && !(paused && snapshot.problem.startsWith('location-') && !snapshot.canRetry) ? text.quality : null;
  const showRetry = snapshot.canRetry && !confirmation && (!!snapshot.problem || snapshot.status === 'interrupted' || snapshot.status === 'off-route' || text.searching);
  const bannerLabel = showManeuver ? `${meters ? `Tra ${meters.label}, ` : ''}${maneuver?.instruction ?? snapshot.instruction ?? ''}` : `${text.header}. ${text.instruction}`;
  const voice = snapshot.voice === 'ready' ? { icon: 'volume-high-outline' as const, label: 'Voce attiva. Disattiva la voce' }
    : snapshot.voice === 'muted' ? { icon: 'volume-mute-outline' as const, label: 'Voce disattivata. Attiva la voce' }
      : snapshot.voice === 'initializing' ? { icon: 'volume-low-outline' as const, label: 'Preparazione della voce' }
        : { icon: 'volume-off-outline' as const, label: 'Voce non disponibile: nessuna voce italiana offline' };
  const glyphSize = Math.round(44 * Math.min(fontScale, 1.3));
  // Height of the 42 sp distance line; every banner state reserves it.
  const firstRow = Math.round(48 * Math.min(fontScale, 1.5));

  return <View pointerEvents="box-none" className="flex-1">
    <View testID="navigation-instruction" accessible accessibilityRole="header" accessibilityLabel={bannerLabel}
      onLayout={event => { banner.current = event.nativeEvent.layout.height; report(); }}
      style={{ backgroundColor: colors.chrome, ...hairlines.bottom, ...(landscape ? { position: 'absolute', top: 0, left: 0, right: 320 } : {}) }} className="px-4 pb-2 pt-3">
      <View className="flex-row items-start gap-3">
        <View style={{ width: glyphSize, minHeight: glyphSize }} className="items-center justify-center pt-1">
          {showManeuver ? <ManeuverGlyphImage glyph={glyph} size={glyphSize} color={colors.textPrimary} />
            : waiting ? <ActivityIndicator color={colors.textPrimary} />
              : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} size={30} color={colors.textPrimary} />}
        </View>
        <View className="min-w-0 flex-1">
          {showManeuver ? <>
            {/* Reserved even when the distance is withheld (paused), so the banner never changes height. */}
            <View style={{ minHeight: firstRow }} className="flex-row items-baseline gap-1">
              {meters ? <><Display size={42} className="text-primary">{meters.value}</Display>
                <Text className="text-xl font-semibold text-secondary">{meters.unit}</Text></> : null}
            </View>
            {/* Two lines reserved: street (or the whole instruction), then the action. */}
            <View style={{ minHeight: Math.round(52 * Math.min(fontScale, 1.5)) }}>
              <Text accessibilityLiveRegion="polite" numberOfLines={2} className="text-xl font-semibold leading-7 text-primary">{lines.primary}</Text>
              {lines.secondary ? <Text numberOfLines={1} className="text-base leading-6 text-secondary">{lines.secondary}</Text> : null}
            </View>
          </> : <>
            <View style={{ minHeight: firstRow }} className="justify-end"><Display size={26} accessibilityLiveRegion="polite" className="text-primary">{text.header}</Display></View>
            <View style={{ minHeight: Math.round(52 * Math.min(fontScale, 1.5)) }}>
              <Text numberOfLines={2} className="text-lg font-semibold leading-6 text-primary">{text.instruction}</Text>
            </View>
          </>}
        </View>
      </View>
      {/* Reserved rows: "Poi …" and status never change the banner height. */}
      <View style={{ minHeight: Math.round(26 * Math.min(fontScale, 1.5)) }} className="flex-row items-center gap-2">
        {then ? <>
          <Text className="text-sm font-semibold text-secondary">Poi</Text>
          <ManeuverGlyphImage glyph={maneuverGlyph(then)} size={22} color={colors.textSecondary} />
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-secondary">{maneuverLines(then, then.instruction).secondary ?? then.instruction}</Text>
        </> : status ? <Num testID="navigation-status" accessibilityLiveRegion="polite" numberOfLines={1} className={`min-w-0 flex-1 text-sm font-semibold ${statusTone}`}>{status}</Num> : null}
      </View>
    </View>

    <View pointerEvents="box-none" className="flex-1" />

    <View testID="navigation-sheet" onLayout={event => { strip.current = event.nativeEvent.layout.height; setStripHeight(strip.current); report(); }}
      style={[hairlines.top, landscape ? { position: 'absolute', right: 0, top: 0, bottom: 0, width: 320 } : null]} className="bg-surface px-3 pb-2 pt-2">
      <View className="flex-row items-center gap-1">
        <PressableSurface surfaceStyle={{ flex: 1, borderRadius: 16 }} rippleColor={`${colors.textPrimary}1F`} contentClassName="min-h-12 justify-center px-2 py-1"
          accessibilityRole="button" accessibilityHint="Apre i dettagli della navigazione"
          accessibilityLabel={`${arrival ? `Arrivo stimato alle ${arrival}, senza traffico` : remainingSeconds != null && paused ? 'Stima sospesa senza una posizione aggiornata; ultima stima' : 'Il tuo viaggio'}${snapshot.distanceRemainingMeters != null ? `, mancano ${remainingSeconds != null ? journeyDuration(remainingSeconds) + ' e ' : ''}${distance(snapshot.distanceRemainingMeters)}` : ''}`}
          onPress={() => setDetailsOpen(true)}>
          {arrival ? <View className="flex-row items-center gap-2">
            <Num testID="navigation-arrival" className="text-xl font-semibold text-primary">{arrival}</Num>
            <View className="shrink">
              <Text numberOfLines={1} className="text-xs leading-4 text-secondary">arrivo stimato</Text>
              <Text numberOfLines={1} className="text-xs leading-4 text-secondary">senza traffico</Text>
            </View>
          </View> : <Text numberOfLines={1} className="text-base font-semibold leading-7 text-primary">{remainingSeconds != null && paused ? 'Stima sospesa' : terminal ? text.header : 'Il tuo viaggio'}</Text>}
          {!transit && snapshot.distanceRemainingMeters != null && !terminal
            ? <Num numberOfLines={1} className={`text-sm ${paused ? 'text-caution' : 'text-secondary'}`}>{remainingSeconds != null ? `${journeyDuration(remainingSeconds)} · ` : ''}{distance(snapshot.distanceRemainingMeters)}</Num>
            : transit ? <Num className="text-sm text-secondary">{`Tratta ${transit.legIndex + 1} di ${transit.legCount}`}</Num> : null}
        </PressableSurface>
        {!terminal && snapshot.sessionId ? <IconButton icon={voice.icon} label={voice.label} active={snapshot.voice === 'muted'}
          disabled={!!busy || (snapshot.voice !== 'ready' && snapshot.voice !== 'muted')} onPress={onMute} /> : null}
        {!terminal ? <IconButton icon="map-outline" label="Panoramica del percorso" active={intent === 'overview'} disabled={!snapshot.route} onPress={onOverview} /> : null}
        <View><Button loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi' : 'Interrompi'}</Button></View>
      </View>
    </View>

    {/* Above the strip, over the map: a problem or Ricentra never changes the strip height, so the
        camera's anchor (and the puck) never jump. It lives in the screen container: Android delivers
        no touches to children drawn outside their parent's bounds. */}
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: landscape ? 320 : 0, bottom: landscape ? 0 : stripHeight }} className="gap-2 pb-2">
      {intent !== 'follow' && snapshot.location ? <View pointerEvents="box-none" className="items-center">
        <PressableSurface testID="navigation-recenter" surfaceStyle={[hairlines.floating, { borderRadius: 24 }]} rippleColor={`${colors.textPrimary}1F`}
          contentClassName="min-h-12 flex-row items-center gap-2 px-5" accessibilityRole="button" accessibilityLabel="Ricentra sulla mia posizione" onPress={onRecenter}>
          <Icon name="navigate-outline" color={colors.textPrimary} /><Text className="text-base font-semibold text-primary">Ricentra</Text>
        </PressableSurface>
      </View> : null}
      {problem || error || showRetry ? <View style={[hairlines.floating, { borderRadius: 16 }]} className="mx-3 flex-row items-center gap-3 px-3 py-2">
        <Text testID="navigation-quality" accessibilityLiveRegion="polite" numberOfLines={3} className="min-w-0 flex-1 text-sm leading-5 text-primary">{error ?? problem ?? text.quality}</Text>
        {showRetry ? <Button variant="secondary" icon="refresh-outline" loading={busy === 'retry'} disabled={!!busy} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi' : 'Riprova'}</Button> : null}
      </View> : null}
      {!terminal && confirmation ? <View className="mx-3"><Button variant="secondary" disabled={!!busy} onPress={() => onConfirmTransit(confirmation)}>{confirmation === 'board' ? 'Sono a bordo' : confirmation === 'alight' ? 'Sono sceso' : 'Sono arrivato'}</Button></View> : null}
    </View>
    <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
      <View style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} className="flex-1 justify-end">
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal className="max-h-[80%] rounded-t-3xl bg-surface">
          <View style={hairlines.bottom} className="flex-row items-center justify-between px-4 py-2">
            <Text accessibilityRole="header" className="mr-2 flex-1 text-lg font-semibold text-primary">Dettagli navigazione</Text>
            <IconButton icon="close-outline" label="Chiudi dettagli" onPress={() => setDetailsOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            {text.precision ? <Num testID="navigation-reduced-precision" className="text-sm font-semibold leading-5 text-caution">{text.precision}</Num> : null}
            {text.signal ? <Num testID="navigation-signal" className="text-sm font-semibold leading-5 text-primary">{text.signal}</Num> : null}
            {text.transitWarning ? <Notice tone="danger" text={text.transitWarning} /> : null}
            {transit ? <Text className="text-sm leading-5 text-secondary">{transit.line ? `${transit.line} · ` : ''}{transit.timingStatus === 'prediction' ? 'Previsioni' : transit.timingStatus === 'scheduled' ? 'Da orario' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Orari non disponibili'} · consultato {clock(transit.fetchedAt)}{transitAge >= 2 ? ` · ${transitAge} min fa, da aggiornare` : ''}</Text> : null}
            {transitMode && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2 || text.transitWarning) ? <Button variant="secondary" icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Scegli la partenza'}</Button> : null}
            {snapshot.nextInstruction ? <Text className="text-sm leading-5 text-secondary">Poi: {snapshot.nextInstruction}</Text> : null}
            {snapshot.location ? <Text className="text-sm leading-5 text-secondary">Ultima posizione accettata: <Num className="text-sm text-secondary">{clock(snapshot.location.timestamp)} · ±{distance(snapshot.location.accuracyMeters)}</Num></Text> : null}
            {snapshot.status === 'arrived' ? <Text className="text-base leading-6 text-primary">Guida terminata. Verifica l’ingresso sul posto.</Text> : null}
            {snapshot.status === 'arrived' && snapshot.destinationDistanceMeters != null && snapshot.destinationDistanceMeters > 30 ? <Text className="text-sm leading-5 text-secondary">La destinazione dista ancora {distance(snapshot.destinationDistanceMeters)} in linea d’aria.</Text> : null}
            {!terminal && snapshot.sessionId && !snapshot.notificationGranted ? <Notice text="Notifiche disattivate: nessun controllo nella barra delle notifiche. Interrompi la guida da qui." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
            {snapshot.problem === 'location-permission' ? <Button variant="secondary" onPress={() => { void Linking.openSettings(); }}>Apri impostazioni</Button> : null}
            {!terminal && snapshot.sessionId ? <>
              <Text testID="navigation-voice" className="text-sm leading-5 text-secondary">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Solo indicazioni visive: installa una voce italiana offline per la guida vocale.'}</Text>
              {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <Button variant="secondary" icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</Button> : null}
            </> : null}
            <Text className="text-sm leading-5 text-secondary">{source}. {transitMode ? 'La posizione non conferma la presenza a bordo: conferma salita e discesa.' : 'Orario di arrivo stimato senza traffico in tempo reale.'} {snapshot.route ? `Percorso consultato alle ${clock(snapshot.route.fetchedAt)}.` : ''}</Text>
            <Text className="text-sm leading-5 text-secondary">La guida può continuare con lo schermo spento finché Android mantiene la sessione attiva.</Text>
          </ScrollView>
          <View className="px-4 pb-3 pt-2"><Button variant="secondary" icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi navigazione' : 'Interrompi navigazione'}</Button></View>
        </SafeAreaView>
      </View>
    </Modal>
  </View>;
}
