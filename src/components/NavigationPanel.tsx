import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LineString } from 'geojson';
import type { Coordinate } from '../domain/types';
import type { NavigationSnapshot, TransitConfirmation } from '../domain/navigation';
import { navigationLocationForReplan } from '../domain/navigation';
import MapCanvas from './MapCanvas';
import { Button, Icon, IconButton, Notice } from './Controls';
import type { NavigationState } from './navigation-controller';
import { journeyDuration } from './journey-presentation';

const tuple = (point: Coordinate): [number, number] => [point.longitude, point.latitude];
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
const statuses: Record<NavigationSnapshot['status'], string> = {
  idle: 'Preparazione', 'waiting-for-fix': 'Ricerca della posizione precisa', routing: 'Calcolo dalla tua posizione',
  navigating: 'Navigazione', 'location-degraded': 'Posizione da ritrovare', 'off-route': 'Fuori percorso', rerouting: 'Ricalcolo del percorso',
  arrived: 'Sei arrivato', stopped: 'Navigazione terminata', interrupted: 'Navigazione interrotta', error: 'Navigazione non disponibile',
};
const problems: Record<NonNullable<NavigationSnapshot['problem']>, string> = {
  'location-permission': 'La posizione precisa non è autorizzata. Abilitala nelle impostazioni dell’app.',
  'location-disabled': 'La posizione del dispositivo è disattivata. Riattivala per proseguire.',
  'location-stale': 'In attesa di una posizione aggiornata. Indicazioni sospese.',
  'location-inaccurate': 'Posizione poco precisa. Le indicazioni riprendono quando il segnale migliora.',
  'route-unavailable': 'Non è stato possibile calcolare il percorso. Controlla la connessione e riprova.',
  'rate-limit': 'Il servizio ha limitato le richieste. Attendi almeno un minuto prima di riprovare.',
  'reroute-limit': 'I ricalcoli automatici sono sospesi. Controlla la posizione e riprova quando necessario.',
  'native-error': 'La navigazione si è interrotta. Riprova dalla tua posizione attuale.',
  'transit-replan-needed': 'Il viaggio va ricalcolato: la partenza è distante, i dati sono da aggiornare oppure una corsa è cancellata. Scegli un nuovo itinerario prima di partire.',
  'engine-unavailable': 'Il motore di navigazione non è disponibile. Interrompi la sessione e riapri l’app.',
  'service-unavailable': 'Android non ha avviato il servizio di navigazione. Mantieni l’app visibile e riprova.',
};
function NavigationButton({ children, icon, onPress, secondary = false, disabled = false, loading = false }: ComponentProps<typeof Button>) {
  const color = secondary ? '#2359D7' : 'white';
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress}
    className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-3 py-3 ${secondary ? 'bg-[#ECF2FF]' : 'bg-[#2359D7]'} ${disabled ? 'opacity-40' : ''}`}>
    {loading ? <ActivityIndicator color={color} /> : icon ? <Icon name={icon} size={20} color={color} /> : null}
    <Text className={`shrink text-center text-base font-semibold ${secondary ? 'text-[#2359D7]' : 'text-white'}`}>{children}</Text>
  </Pressable>;
}

export function NavigationPanel({ snapshot, busy, error, fallbackCenter, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  fallbackCenter: Coordinate; onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stackActions = width / fontScale < 300;
  const showActionIcons = width / fontScale >= 360;
  const [following, setFollowing] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  const geometry = snapshot.route?.geometry;
  const route = useMemo<LineString | null>(() => geometry && geometry.length > 1 ? { type: 'LineString', coordinates: geometry.map(tuple) } : null, [geometry]);
  const terminal = snapshot.status === 'arrived' || snapshot.status === 'interrupted' || snapshot.status === 'error';
  const guiding = snapshot.status === 'navigating';
  const waiting = busy === 'start' || snapshot.status === 'waiting-for-fix' || snapshot.status === 'routing' || snapshot.status === 'rerouting';
  const center = snapshot.location ?? snapshot.destination ?? fallbackCenter;
  const remainingSeconds = guiding && snapshot.mode !== 'transit' ? snapshot.durationRemainingSeconds : undefined;
  const arrival = remainingSeconds != null && snapshot.location ? new Date(snapshot.location.timestamp + remainingSeconds * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null;
  const transit = snapshot.transit;
  const time = (value: number) => new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const transitAge = transit ? Math.max(0, Math.floor((now - transit.fetchedAt) / 60_000)) : 0;
  const replanLocation = navigationLocationForReplan(snapshot);
  const voiceLabel = snapshot.voice === 'ready' ? 'Voce attiva' : snapshot.voice === 'muted' ? 'Voce disattivata' : snapshot.voice === 'initializing' ? 'Preparazione voce' : 'Voce non disponibile';
  const source = snapshot.route?.source ?? (snapshot.mode === 'transit' ? 'MATO / 5T' : 'FOSSGIS / OpenStreetMap');
  return <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
    <View className="bg-[#17243C] px-4 py-3">
      <View className="flex-row items-center gap-2">
        {waiting ? <ActivityIndicator color="white" /> : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} color="white" />}
        <Text accessibilityRole="header" className="flex-1 text-base font-semibold text-white">{busy === 'start' && snapshot.status === 'idle' ? 'Preparazione della navigazione' : snapshot.status === 'location-degraded' && !snapshot.location ? 'In attesa della posizione' : statuses[snapshot.status]}</Text>
      </View>
      {guiding && snapshot.instruction ? <Text accessibilityLiveRegion="polite" className="mt-3 text-2xl font-bold leading-8 text-white">{!transit && snapshot.distanceToManeuverMeters != null ? `Tra ${distance(snapshot.distanceToManeuverMeters)}: ` : ''}{snapshot.instruction}</Text> : null}
      {guiding && snapshot.nextInstruction ? <Text className="mt-2 text-base leading-6 text-[#D8E5FF]">Poi: {snapshot.nextInstruction}</Text> : null}
    </View>
    <View className="min-h-32 flex-1 bg-[#DFE8EB]">
      <MapCanvas center={tuple(center)} userLocation={snapshot.location ? tuple(snapshot.location) : null} route={route}
        zoom={17} followLocation={following} onRegionChanged={() => setFollowing(false)} />
      <View className="absolute bottom-10 right-4">
        <IconButton icon="locate-outline" label="Ricentra sulla mia posizione" active={following} disabled={!snapshot.location} onPress={() => setFollowing(true)} />
      </View>
    </View>
    <ScrollView className="max-h-[36%] grow-0 shrink" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
      {snapshot.problem ? <Notice danger text={snapshot.problem === 'location-stale' && !snapshot.location ? 'Nessuna posizione precisa ricevuta. Riprova vicino a una finestra o all’aperto.' : problems[snapshot.problem]} action={snapshot.problem === 'location-permission' ? 'Apri impostazioni' : undefined} onAction={() => { void Linking.openSettings(); }} /> : null}
      {error ? <Notice danger text={error} /> : null}
      {snapshot.location && !guiding && !terminal ? <Text className="text-xs leading-5 text-[#59667A]">Ultima posizione rilevata alle {time(snapshot.location.timestamp)}. Precisione circa {distance(snapshot.location.accuracyMeters)}.</Text> : null}
      {guiding && !transit && snapshot.distanceRemainingMeters != null ? <View className="flex-row flex-wrap items-baseline gap-x-4 gap-y-1">
        {remainingSeconds != null ? <Text className="text-2xl font-bold text-[#2359D7]">{journeyDuration(remainingSeconds)}</Text> : null}
        <Text className="text-lg text-[#17243C]">{distance(snapshot.distanceRemainingMeters)}</Text>
        {arrival ? <Text className="text-base text-[#59667A]">Arrivo stimato {arrival}</Text> : null}
      </View> : null}
      {transit ? <View className="gap-2">
        <Text className="text-base font-semibold text-[#17243C]">{transit.sourceLegIndices && transit.sourceLegIndices.length > 1 ? `Tratte ${transit.sourceLegIndices[0]! + 1}–${transit.sourceLegIndices.at(-1)! + 1}` : `Tratta ${transit.legIndex + 1}`} di {transit.legCount}{transit.line ? ` · ${transit.line}` : ''}{transit.headsign ? ` verso ${transit.headsign}` : ''}</Text>
        {transit.from || transit.to ? <Text className="text-sm leading-5 text-[#59667A]">{transit.from ?? 'Partenza'} → {transit.to ?? 'Destinazione'}</Text> : null}
        <Text className="text-sm leading-5 text-[#59667A]">{transit.timingStatus === 'scheduled' ? 'Orari programmati' : transit.timingStatus === 'prediction' ? 'Previsioni consultate' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Stato della corsa non disponibile'}{transit.departureAt ? ` · partenza ${time(transit.departureAt)}` : ''}{transit.arrivalAt ? ` · arrivo ${time(transit.arrivalAt)}` : ''}. Dati consultati {transitAge < 1 ? 'meno di un minuto fa' : `${transitAge} min fa`}.</Text>
        {transitAge >= 2 ? <Notice text="Dati da aggiornare. Verifica partenze e cambi: le corse non sono monitorate durante la guida." /> : null}
        {guiding && snapshot.distanceToManeuverMeters != null ? <Text className="text-sm text-[#59667A]">Distanza dal punto da raggiungere in linea d’aria: {distance(snapshot.distanceToManeuverMeters)}.</Text> : null}
        {transit.proximityAvailable === false ? <Notice text="L’avviso di vicinanza non è disponibile per questa tratta. Verifica la fermata e conferma manualmente." /> : null}
        {(transit.phase === 'walk' || transit.phase === 'transfer') ? <Text className="text-sm leading-5 text-[#59667A]">Segui il tracciato a piedi e verifica i passaggi sul posto. Per questa tratta non sono disponibili indicazioni di svolta.</Text> : null}
        {!terminal && !guiding ? <Notice text="Conferma manualmente salita e discesa quando le effettui. Senza una posizione valida gli avvisi vicino alle fermate sono sospesi." /> : null}
        {!terminal && transit.canConfirmWalking ? <NavigationButton secondary disabled={!!busy} onPress={() => onConfirmTransit('walk-complete')}>Ho raggiunto {transit.to ?? 'la fine della tratta'}</NavigationButton> : null}
        {!terminal && transit.canConfirmBoarding ? <NavigationButton disabled={!!busy} icon="bus-outline" onPress={() => onConfirmTransit('board')}>Sono a bordo{transit.line ? ` · ${transit.line}` : ''}</NavigationButton> : null}
        {!terminal && transit.canConfirmAlighting ? <NavigationButton disabled={!!busy} icon="walk-outline" onPress={() => onConfirmTransit('alight')}>Sono sceso{transit.to ? ` a ${transit.to}` : ''}</NavigationButton> : null}
      </View> : null}
      {snapshot.status === 'interrupted' ? <Notice text="La sessione precedente si è interrotta. Riprendi per calcolare un nuovo percorso dalla tua posizione attuale." /> : null}
      {snapshot.status === 'arrived' ? <Text className="text-base leading-6 text-[#17243C]">Hai raggiunto la fine del percorso. L’ingresso della destinazione può trovarsi in un punto diverso. Posizione continua e guida vocale sono terminate.</Text> : null}
      {snapshot.status === 'arrived' && snapshot.destinationDistanceMeters != null && snapshot.destinationDistanceMeters > 30 ? <Text className="text-sm leading-5 text-[#59667A]">Il punto selezionato dista ancora circa {distance(snapshot.destinationDistanceMeters)} in linea d’aria dalla fine del percorso. Verifica l’accesso sul posto.</Text> : null}
      {waiting ? <Text className="text-sm leading-5 text-[#59667A]">{snapshot.mode === 'transit' ? 'Controllo della tua posizione rispetto alla partenza del viaggio selezionato.' : 'La navigazione parte dalla posizione attuale, anche quando l’anteprima aveva una partenza diversa.'}</Text> : null}
    </ScrollView>
    <View className="gap-2 border-t border-[#E2E8F0] bg-white px-4 pb-3 pt-2">
      <View className="flex-row items-center justify-between gap-2">
        {!terminal && snapshot.sessionId ? <View className="flex-1 flex-row items-center gap-2">
          <Icon name={snapshot.voice === 'ready' ? 'volume-high-outline' : 'volume-mute-outline'} size={16} color="#59667A" />
          <Text className="flex-1 text-xs text-[#59667A]">{voiceLabel}</Text>
        </View> : <Text className="flex-1 text-xs text-[#59667A]" numberOfLines={2}>{source}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Apri dettagli della navigazione" onPress={() => setDetailsOpen(true)} className="min-h-11 flex-row items-center gap-1 px-2">
          <Text className="text-sm font-semibold text-[#2359D7]">Dettagli</Text>
          <Icon name="information-circle-outline" size={18} color="#2359D7" />
        </Pressable>
      </View>
      {snapshot.mode === 'transit' && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2) ? <NavigationButton secondary icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Scegli la partenza'}</NavigationButton> : null}
      <View className={stackActions ? 'gap-2' : 'flex-row gap-2'}>
        {snapshot.canRetry ? <View className={stackActions ? '' : 'min-w-0 flex-1'}><NavigationButton icon={showActionIcons ? 'refresh-outline' : undefined} loading={busy === 'retry'} disabled={!!busy} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi' : 'Riprova'}</NavigationButton></View> : null}
        <View className={stackActions ? '' : 'min-w-0 flex-1'}><NavigationButton secondary icon={showActionIcons ? terminal ? 'close-outline' : 'stop-circle-outline' : undefined} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi' : 'Interrompi'}</NavigationButton></View>
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
            {snapshot.location ? <Text className="text-sm leading-5 text-[#59667A]">{guiding ? 'Precisione della posizione' : 'Ultima posizione'}: circa {distance(snapshot.location.accuracyMeters)}{guiding || terminal ? '' : '. Indicazioni in attesa di un segnale valido.'}</Text> : null}
            {!terminal && snapshot.sessionId ? <>
              <Text className="text-sm leading-5 text-[#59667A]">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Per la guida vocale serve una voce italiana offline installata sul dispositivo. Puoi seguire le indicazioni sullo schermo.'}</Text>
              {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <NavigationButton secondary icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</NavigationButton> : null}
              {!snapshot.notificationGranted ? <Notice text="Notifiche non autorizzate: per interrompere la navigazione torna in questa schermata. Puoi abilitarle nelle impostazioni dell’app." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
            </> : null}
            <Text className="text-sm leading-5 text-[#59667A]">{source}. {snapshot.mode === 'transit' ? 'La posizione non conferma la presenza a bordo: conferma salita e discesa.' : 'Stime senza traffico in tempo reale.'} {snapshot.route ? `Percorso consultato alle ${time(snapshot.route.fetchedAt)}.` : ''}</Text>
            <Text className="text-sm leading-5 text-[#59667A]">La guida può continuare con lo schermo spento finché Android mantiene la sessione attiva.</Text>
          </ScrollView>
          <View className="px-4 pb-3 pt-2"><NavigationButton secondary icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi navigazione' : 'Interrompi navigazione'}</NavigationButton></View>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}
