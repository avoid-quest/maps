import { Text, View } from 'react-native';
import type { Stop } from '../../domain/types';
import type { SavedJourney, SavedTravelFailure, SavedTravelSnapshot } from '../../services/saved-travel';
import { Button, Notice } from '../../ui';
import { journeyDate, journeyTime, savedJourneyTimeLabel } from '../planner/journey-presentation';

export function savedTravelFailureMessage(failure: SavedTravelFailure | null): string | null {
  if (!failure) return null;
  const messages: Record<SavedTravelFailure, string> = {
    'invalid-data': 'I dati salvati non sono leggibili. Puoi rimuoverli e salvare una nuova copia.',
    'too-large': 'I dati superano lo spazio previsto per una copia locale. La copia salvata non è stata modificata.',
    'storage-unavailable': 'Memoria locale non disponibile. L’operazione non è riuscita: riprova.',
    'stop-unavailable': 'Fermata non riconosciuta nel pacchetto attuale. Scegli una fermata dall’elenco Trasporti.',
    'limit-reached': 'Hai raggiunto il limite di fermate salvate. Rimuovine una prima di aggiungerne altre.',
    'not-ready': 'Caricamento dei salvataggi in corso. Riprova tra poco.',
  };
  return messages[failure];
}

export function SavedTravelPanel({ snapshot, journeyBusy, stopsBusy, onOpenJourney, onClearJourney, onOpenStop, onRemoveStop, onClearStops }: {
  snapshot: SavedTravelSnapshot; journeyBusy: boolean; stopsBusy: boolean;
  onOpenJourney: (journey: SavedJourney) => void; onClearJourney: () => void;
  onOpenStop: (stop: Stop) => void; onRemoveStop: (id: string) => void; onClearStops: () => void;
}) {
  const journeyError = savedTravelFailureMessage(snapshot.journeyFailure);
  const stopsError = savedTravelFailureMessage(snapshot.stopsFailure);
  const scheduleLabel = snapshot.journey ? savedJourneyTimeLabel(
    snapshot.journey.query.transitTime, snapshot.journey.plan.fetchedAt, snapshot.journey.query.mode,
  ) : null;
  return (
    <View className="gap-4 p-4">
      <View className="gap-3">
        <Text className="text-base font-semibold text-primary">Viaggio salvato</Text>
        {snapshot.journeyStatus === 'loading' ? <Text className="text-sm text-secondary">Carico il viaggio salvato…</Text> : null}
        {journeyError ? <Notice tone="danger" text={journeyError} /> : null}
        {snapshot.journey ? (
          <View className="gap-3 rounded-2xl border border-divider bg-surface-raised p-4">
            <Text className="text-base font-semibold leading-6 text-primary">{snapshot.journey.originLabel} → {snapshot.journey.destinationLabel}</Text>
            <Text className="text-sm font-semibold text-stale">Da aggiornare</Text>
            {scheduleLabel ? <Text className="text-sm leading-5 text-secondary">{scheduleLabel}</Text> : null}
            <Text className="text-xs leading-5 text-secondary">Consultato il {journeyDate(snapshot.journey.plan.fetchedAt)} alle {journeyTime(snapshot.journey.plan.fetchedAt)}. Percorso: {snapshot.journey.plan.source}.</Text>
            <Button icon="map-outline" onPress={() => onOpenJourney(snapshot.journey!)}>Apri viaggio</Button>
            <Button variant="secondary" icon="trash-outline" loading={journeyBusy} onPress={onClearJourney}>Rimuovi viaggio</Button>
          </View>
        ) : snapshot.journeyStatus === 'ready' ? <Text className="text-sm leading-6 text-secondary">Nessun viaggio salvato.</Text> : null}
        {!snapshot.journey && snapshot.journeyStatus === 'unavailable' ? <Button variant="secondary" loading={journeyBusy} onPress={onClearJourney}>Cancella dati del viaggio</Button> : null}
      </View>
      <View className="gap-3">
        <Text className="text-base font-semibold text-primary">Fermate salvate</Text>
        {snapshot.stopsStatus === 'loading' ? <Text className="text-sm text-secondary">Carico le fermate salvate…</Text> : null}
        {stopsError ? <Notice tone="danger" text={stopsError} /> : null}
        {snapshot.stops.map(({ saved, current }) => (
          <View key={saved.id} className="gap-3 rounded-2xl border border-divider bg-surface-raised p-4">
            <Text className="text-base font-semibold text-primary">{current?.name ?? saved.name}</Text>
            <Text className="text-sm text-secondary">Fermata {saved.code} · GTT</Text>
            {current ? <Button icon="bus-outline" onPress={() => onOpenStop(current)}>Apri arrivi · {saved.code}</Button> : <Notice text="Fermata non riconosciuta. Sceglila di nuovo da Trasporti." />}
            <Button variant="secondary" disabled={stopsBusy} onPress={() => onRemoveStop(saved.id)}>Rimuovi fermata {saved.code}</Button>
          </View>
        ))}
        {snapshot.stopsStatus === 'ready' && !snapshot.stops.length ? <Text className="text-sm leading-6 text-secondary">Nessuna fermata salvata.</Text> : null}
        {snapshot.stops.length || snapshot.stopsStatus === 'unavailable' ? <Button variant="secondary" loading={stopsBusy} onPress={onClearStops}>Rimuovi tutte le fermate</Button> : null}
      </View>
      <Text className="text-base font-semibold text-primary">Luoghi salvati</Text>
    </View>
  );
}
