import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LineString } from 'geojson';
import type { Coordinate } from '../domain/types';
import type { NavigationSnapshot, TransitConfirmation } from '../domain/navigation';
import { navigationLocationForReplan } from '../domain/navigation';
import MapCanvas from './MapCanvas';
import { Button, Icon, IconButton, Notice } from './Controls';
import type { NavigationState } from './navigation-controller';

const tuple = (point: Coordinate): [number, number] => [point.longitude, point.latitude];
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
const duration = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `${Math.floor(seconds / 3600)} h ${Math.round(seconds % 3600 / 60)} min`;
const statuses: Record<NavigationSnapshot['status'], string> = {
  idle: 'Preparazione', 'waiting-for-fix': 'Ricerca della posizione precisa', routing: 'Calcolo dalla tua posizione',
  navigating: 'Navigazione', 'location-degraded': 'Posizione da ritrovare', 'off-route': 'Fuori percorso', rerouting: 'Ricalcolo del percorso',
  arrived: 'Sei arrivato', stopped: 'Navigazione terminata', interrupted: 'Navigazione interrotta', error: 'Navigazione non disponibile',
};
const problems: Record<NonNullable<NavigationSnapshot['problem']>, string> = {
  'location-permission': 'La posizione precisa non è autorizzata. Abilitala nelle impostazioni dell’app.',
  'location-disabled': 'La posizione del dispositivo è disattivata. Riattivala per proseguire.',
  'location-stale': 'Il segnale di posizione non è aggiornato. Le indicazioni riprenderanno con un nuovo segnale preciso.',
  'location-inaccurate': 'La posizione è poco precisa. Le indicazioni riprenderanno quando il segnale migliora.',
  'route-unavailable': 'Non è stato possibile calcolare il percorso. Controlla la connessione e riprova.',
  'rate-limit': 'Il servizio ha limitato le richieste. Attendi almeno un minuto prima di riprovare.',
  'reroute-limit': 'I ricalcoli automatici sono sospesi. Controlla la posizione e riprova quando necessario.',
  'native-error': 'La navigazione si è interrotta. Riprova dalla tua posizione attuale.',
  'transit-replan-needed': 'Il viaggio va ricalcolato: la partenza è distante, i dati sono da aggiornare oppure una corsa è cancellata. Scegli un nuovo itinerario prima di partire.',
  'engine-unavailable': 'Il motore di navigazione non è disponibile. Interrompi la sessione e riapri l’app.',
  'service-unavailable': 'Android non ha avviato il servizio di navigazione. Mantieni l’app visibile e riprova.',
};
export function NavigationPanel({ snapshot, busy, error, fallbackCenter, onStop, onRetry, onMute, onConfirmTransit, onReplan }: NavigationState & {
  fallbackCenter: Coordinate; onStop: () => void; onRetry: () => void; onMute: () => void;
  onConfirmTransit: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const [following, setFollowing] = useState(true);
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
  const replanLocation = navigationLocationForReplan(snapshot, now);
  return <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
    <View className="bg-[#17243C] px-5 py-4">
      <View className="flex-row items-center gap-2">
        {waiting ? <ActivityIndicator color="white" /> : <Icon name={snapshot.status === 'arrived' ? 'flag-outline' : 'navigate-outline'} color="white" />}
        <Text accessibilityRole="header" className="flex-1 text-base font-semibold text-white">{busy === 'start' && snapshot.status === 'idle' ? 'Preparazione della navigazione' : statuses[snapshot.status]}</Text>
      </View>
      {guiding && snapshot.instruction ? <Text accessibilityLiveRegion="polite" className="mt-3 text-2xl font-bold leading-8 text-white">{!transit && snapshot.distanceToManeuverMeters != null ? `Tra ${distance(snapshot.distanceToManeuverMeters)}: ` : ''}{snapshot.instruction}</Text> : null}
      {guiding && snapshot.nextInstruction ? <Text className="mt-2 text-base leading-6 text-[#D8E5FF]">Poi: {snapshot.nextInstruction}</Text> : null}
    </View>
    <View className="min-h-40 flex-1 bg-[#DFE8EB]">
      <MapCanvas center={tuple(center)} userLocation={snapshot.location ? tuple(snapshot.location) : null} route={route}
        zoom={17} followLocation={following} onRegionChanged={() => setFollowing(false)} />
      <View className="absolute bottom-10 right-4">
        <IconButton icon="locate-outline" label="Ricentra sulla mia posizione" active={following} disabled={!snapshot.location} onPress={() => setFollowing(true)} />
      </View>
    </View>
    <ScrollView className="max-h-[48%]" contentContainerStyle={{ padding: 20, gap: 14 }}>
      {guiding && !transit && snapshot.distanceRemainingMeters != null ? <View className="flex-row flex-wrap items-baseline gap-x-4 gap-y-1">
        {remainingSeconds != null ? <Text className="text-3xl font-bold text-[#2359D7]">{duration(remainingSeconds)}</Text> : null}
        <Text className="text-lg text-[#17243C]">{distance(snapshot.distanceRemainingMeters)}</Text>
        {arrival ? <Text className="text-base text-[#59667A]">Arrivo stimato {arrival}</Text> : null}
      </View> : null}
      {transit ? <View className="gap-2">
        <Text className="text-base font-semibold text-[#17243C]">{transit.sourceLegIndices && transit.sourceLegIndices.length > 1 ? `Tratte ${transit.sourceLegIndices[0]! + 1}–${transit.sourceLegIndices.at(-1)! + 1}` : `Tratta ${transit.legIndex + 1}`} di {transit.legCount}{transit.line ? ` · ${transit.line}` : ''}{transit.headsign ? ` verso ${transit.headsign}` : ''}</Text>
        {transit.from || transit.to ? <Text className="text-sm leading-5 text-[#59667A]">{transit.from ?? 'Partenza'} → {transit.to ?? 'Destinazione'}</Text> : null}
        <Text className="text-sm leading-5 text-[#59667A]">{transit.timingStatus === 'scheduled' ? 'Orari programmati' : transit.timingStatus === 'prediction' ? 'Previsioni consultate' : transit.timingStatus === 'cancelled' ? 'Corsa cancellata' : 'Stato della corsa non disponibile'}{transit.departureAt ? ` · partenza ${time(transit.departureAt)}` : ''}{transit.arrivalAt ? ` · arrivo ${time(transit.arrivalAt)}` : ''}. Dati consultati {transitAge < 1 ? 'meno di un minuto fa' : `${transitAge} min fa`}.</Text>
        {transitAge >= 2 ? <Notice text="Dati del viaggio da aggiornare. Le corse non vengono monitorate automaticamente durante la guida; verifica partenze e cambi." /> : null}
        {guiding && snapshot.distanceToManeuverMeters != null ? <Text className="text-sm text-[#59667A]">Distanza dal punto da raggiungere in linea d’aria: {distance(snapshot.distanceToManeuverMeters)}.</Text> : null}
        {transit.proximityAvailable === false ? <Notice text="L’avviso di vicinanza non è disponibile per questa tratta. Verifica la fermata e conferma manualmente." /> : null}
        {(transit.phase === 'walk' || transit.phase === 'transfer') ? <Text className="text-sm leading-5 text-[#59667A]">Segui il tracciato a piedi e verifica i passaggi sul posto. Per questa tratta non sono disponibili indicazioni di svolta.</Text> : null}
        {!terminal && !guiding ? <Notice text="Conferma manualmente salita e discesa quando le effettui. Senza una posizione valida gli avvisi vicino alle fermate sono sospesi." /> : null}
        {!terminal && transit.canConfirmWalking ? <Button secondary disabled={!!busy} onPress={() => onConfirmTransit('walk-complete')}>Ho raggiunto {transit.to ?? 'la fine della tratta'}</Button> : null}
        {!terminal && transit.canConfirmBoarding ? <Button disabled={!!busy} icon="bus-outline" onPress={() => onConfirmTransit('board')}>Sono a bordo{transit.line ? ` · ${transit.line}` : ''}</Button> : null}
        {!terminal && transit.canConfirmAlighting ? <Button disabled={!!busy} icon="walk-outline" onPress={() => onConfirmTransit('alight')}>Sono sceso{transit.to ? ` a ${transit.to}` : ''}</Button> : null}
      </View> : null}
      {snapshot.status === 'interrupted' ? <Notice text="La sessione precedente si è interrotta. Riprendi per calcolare un nuovo percorso dalla tua posizione attuale." /> : null}
      {snapshot.status === 'arrived' ? <Text className="text-base leading-6 text-[#17243C]">Hai raggiunto la fine del percorso. L’ingresso della destinazione può trovarsi in un punto diverso. Posizione continua e guida vocale sono terminate.</Text> : null}
      {snapshot.status === 'arrived' && snapshot.destinationDistanceMeters != null && snapshot.destinationDistanceMeters > 30 ? <Text className="text-sm leading-5 text-[#59667A]">Il punto selezionato dista ancora circa {distance(snapshot.destinationDistanceMeters)} in linea d’aria dalla fine del percorso. Verifica l’accesso sul posto.</Text> : null}
      {waiting ? <Text className="text-sm leading-5 text-[#59667A]">{snapshot.mode === 'transit' ? 'Controllo della tua posizione rispetto alla partenza del viaggio selezionato.' : 'La navigazione parte dalla posizione attuale, anche quando l’anteprima aveva una partenza diversa.'}</Text> : null}
      {snapshot.problem ? <Notice danger text={problems[snapshot.problem]} action={snapshot.problem === 'location-permission' ? 'Apri impostazioni' : undefined} onAction={() => { void Linking.openSettings(); }} /> : null}
      {error ? <Notice danger text={error} /> : null}
      {snapshot.location ? <Text className="text-sm text-[#59667A]">{guiding ? 'Precisione della posizione' : 'Ultima posizione'}: circa {distance(snapshot.location.accuracyMeters)}{guiding || terminal ? '' : ' · indicazioni in attesa di un segnale valido'}</Text> : null}
      {!terminal && snapshot.sessionId ? <>
        <Text className="text-sm leading-5 text-[#59667A]">{snapshot.voice === 'ready' ? 'Voce italiana disponibile sul dispositivo.' : snapshot.voice === 'muted' ? 'Voce disattivata.' : snapshot.voice === 'initializing' ? 'Preparazione della voce…' : 'Voce non disponibile. Serve una voce italiana offline installata sul dispositivo; puoi seguire le indicazioni sullo schermo.'}</Text>
        {(snapshot.voice === 'ready' || snapshot.voice === 'muted') ? <Button secondary icon={snapshot.voice === 'muted' ? 'volume-high-outline' : 'volume-mute-outline'} disabled={!!busy} onPress={onMute}>{snapshot.voice === 'muted' ? 'Attiva voce' : 'Disattiva voce'}</Button> : null}
        {!snapshot.notificationGranted ? <Notice text="Notifiche non autorizzate: per interrompere la navigazione torna in questa schermata. Puoi abilitarle nelle impostazioni dell’app." /> : null}
      </> : null}
      {snapshot.canRetry ? <Button secondary icon="refresh-outline" loading={busy === 'retry'} disabled={!!busy} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi dalla mia posizione' : 'Riprova dalla mia posizione'}</Button> : null}
      {snapshot.mode === 'transit' && (snapshot.problem === 'transit-replan-needed' || transitAge >= 2) ? <Button secondary icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Torna al percorso e scegli la partenza'}</Button> : null}
      <Button icon={terminal ? 'close-outline' : 'stop-circle-outline'} loading={busy === 'stop'} onPress={onStop}>{terminal ? 'Chiudi navigazione' : 'Interrompi navigazione'}</Button>
      <Text className="text-xs leading-5 text-[#59667A]">{snapshot.route?.source ?? (snapshot.mode === 'transit' ? 'MATO / 5T' : 'FOSSGIS / OpenStreetMap')}. {snapshot.mode === 'transit' ? 'La posizione non conferma la presenza a bordo: conferma salita e discesa.' : 'Stime senza traffico in tempo reale.'} La guida può continuare con lo schermo spento finché Android mantiene la sessione attiva. {snapshot.route ? `Percorso consultato alle ${time(snapshot.route.fetchedAt)}.` : ''}</Text>
    </ScrollView>
  </SafeAreaView>;
}
