import { Text, View } from 'react-native';
import type { Stop } from '../domain/types';
import type { SavedJourney, SavedTravelFailure, SavedTravelSnapshot } from '../services/saved-travel';
import { Button, Notice } from './Controls';
import { journeyDate, journeyTime, savedJourneyTimeLabel } from './journey-presentation';

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
  return (
    <View className="gap-6 p-5">
      <Text className="text-sm leading-6 text-[#59667A]">Viaggi, fermate e luoghi restano su questo dispositivo, senza account. La copia di un viaggio si aggiorna solo quando la sostituisci.</Text>
      <View className="gap-3">
        <Text className="text-xl font-bold text-[#17243C]">Viaggio salvato</Text>
        {snapshot.journeyStatus === 'loading' ? <Text className="text-sm text-[#59667A]">Carico il viaggio salvato…</Text> : null}
        {journeyError ? <Notice danger text={journeyError} /> : null}
        {snapshot.journey ? (
          <View className="gap-3 rounded-2xl border border-[#E2E8F0] p-4">
            <Text className="text-base font-semibold leading-6 text-[#17243C]">{snapshot.journey.originLabel} → {snapshot.journey.destinationLabel}</Text>
            <Text className="text-sm font-semibold text-[#9A5800]">Viaggio salvato · da aggiornare</Text>
            <Text className="text-sm leading-5 text-[#59667A]">{savedJourneyTimeLabel(snapshot.journey.query.transitTime, snapshot.journey.plan.fetchedAt)}</Text>
            <Text className="text-xs leading-5 text-[#59667A]">Consultato il {journeyDate(snapshot.journey.plan.fetchedAt)} alle {journeyTime(snapshot.journey.plan.fetchedAt)}. Percorso: {snapshot.journey.plan.source}.</Text>
            <Button icon="map-outline" onPress={() => onOpenJourney(snapshot.journey!)}>Apri viaggio salvato</Button>
            <Button secondary icon="trash-outline" loading={journeyBusy} onPress={onClearJourney}>Rimuovi viaggio salvato</Button>
          </View>
        ) : snapshot.journeyStatus === 'ready' ? <Text className="text-sm leading-6 text-[#59667A]">Nessun viaggio salvato. Calcola un percorso e salva quello selezionato per ritrovarne la copia anche senza connessione.</Text> : null}
        {!snapshot.journey && snapshot.journeyStatus === 'unavailable' ? <Button secondary loading={journeyBusy} onPress={onClearJourney}>Cancella dati del viaggio</Button> : null}
      </View>
      <View className="gap-3">
        <Text className="text-xl font-bold text-[#17243C]">Fermate salvate</Text>
        <Text className="text-sm leading-6 text-[#59667A]">Apri una fermata per richiedere arrivi e avvisi GTT. Gli arrivi richiedono una connessione e non sono salvati.</Text>
        {snapshot.stopsStatus === 'loading' ? <Text className="text-sm text-[#59667A]">Carico le fermate salvate…</Text> : null}
        {stopsError ? <Notice danger text={stopsError} /> : null}
        {snapshot.stops.map(({ saved, current }) => (
          <View key={saved.id} className="gap-3 rounded-2xl border border-[#E2E8F0] p-4">
            <Text className="text-base font-semibold text-[#17243C]">{current?.name ?? saved.name}</Text>
            <Text className="text-sm text-[#59667A]">Fermata {saved.code} · GTT</Text>
            {current ? <Button icon="bus-outline" onPress={() => onOpenStop(current)}>Apri arrivi · {saved.code}</Button> : <Notice text="Fermata non riconosciuta nel pacchetto attuale. Non è possibile richiederne gli arrivi. Puoi rimuoverla e sceglierla di nuovo da Trasporti." />}
            <Button secondary disabled={stopsBusy} onPress={() => onRemoveStop(saved.id)}>Rimuovi fermata {saved.code}</Button>
          </View>
        ))}
        {snapshot.stopsStatus === 'ready' && !snapshot.stops.length ? <Text className="text-sm leading-6 text-[#59667A]">Nessuna fermata salvata. Apri una fermata dalla scheda Trasporti e tocca Salva fermata.</Text> : null}
        {snapshot.stops.length || snapshot.stopsStatus === 'unavailable' ? <Button secondary loading={stopsBusy} onPress={onClearStops}>Rimuovi tutte le fermate</Button> : null}
      </View>
      <Text className="text-xl font-bold text-[#17243C]">Luoghi salvati</Text>
    </View>
  );
}
