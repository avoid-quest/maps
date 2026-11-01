import { useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import type { Place } from '../../domain/types';
import { useThemeColors } from '../../theme';
import { Icon, IconButton, ListRow, Notice, SectionHeader, useHairlines } from '../../ui';
import { Text } from '../../ui/Text';
import type { PlannerEndpoint } from '../app/task-model';
import { useDistanceReference } from '../map/useDistanceReference';
import { useMapContext } from '../map/useMapModel';
import { PlaceRow } from '../places/PlaceRow';
import { usePlacesContext } from '../places/usePlaces';
import { usePlaceLookup } from '../search/usePlaceLookup';
import { usePlannerContext } from './usePlanner';

/**
 * Searching for the origin or destination inside the planner: the same local, Photon (when allowed)
 * and stop search as the main field, plus saved places; for the origin also the device position and
 * a tap on the map.
 */
export function EndpointEditor({ endpoint, current }: { endpoint: PlannerEndpoint; current: Place | null }) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const planner = usePlannerContext();
  const { locate, camera } = useMapContext();
  const { saved, isSaved } = usePlacesContext();
  const reference = useDistanceReference();
  const [query, setQuery] = useState('');
  const lookup = usePlaceLookup(query, camera.searchCenter, true);
  const origin = endpoint === 'origin';
  const typed = query.trim().length >= 2;
  const choose = (place: Place) => planner.chooseEndpoint(place);
  const suggestions = saved.filter(place => place.id !== current?.id).slice(0, 6);
  return (
    <View className="gap-2 py-2">
      <View className="px-4">
        <View style={hairlines.floating} className="min-h-12 flex-row items-center rounded-full px-1">
          <IconButton icon="arrow-back" label="Torna al percorso" onPress={planner.closeEndpointEditor} />
          <TextInput
            autoFocus
            accessibilityLabel={origin ? 'Cerca la partenza' : 'Cerca la destinazione'}
            className="min-h-12 min-w-0 flex-1 px-2 font-sans text-base text-primary"
            placeholder={origin ? 'Partenza: luogo, indirizzo o fermata' : 'Destinazione: luogo, indirizzo o fermata'}
            placeholderTextColor={colors.textSecondary}
            selectionColor={colors.action}
            cursorColor={colors.action}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={() => { if (lookup.places[0]) choose(lookup.places[0]); }}
          />
          {lookup.searching ? <View className="h-12 w-8 items-center justify-center"><ActivityIndicator size="small" color={colors.textPrimary} /></View> : null}
          {query ? <IconButton icon="close" label="Cancella testo" onPress={() => setQuery('')} /> : null}
        </View>
      </View>
      {!typed ? (
        <View>
          {origin ? <>
            <ListRow title="La tua posizione" subtitle="Una posizione aggiornata del dispositivo" icon="locate-outline" kind="none" onPress={() => { void locate(); }} />
            <ListRow title="Scegli sulla mappa" subtitle="Tocca il punto di partenza" icon="map-outline" kind="none" onPress={planner.pickOriginOnMap} />
          </> : null}
          {suggestions.length ? <>
            <SectionHeader title="Salvati" />
            {suggestions.map(place => <PlaceRow key={place.id} place={place} saved reference={reference} onPress={() => choose(place)} />)}
          </> : null}
          <Text className="px-4 pt-3 text-sm leading-5 text-secondary">
            {lookup.policy === 'local-only' ? 'Solo ricerca locale: il testo resta sul dispositivo.' : 'Luoghi e fermate locali; nomi e indirizzi anche con Photon / OpenStreetMap.'}
          </Text>
        </View>
      ) : (
        <View>
          {lookup.error ? <View className="px-4 pb-2"><Notice tone="danger" text={lookup.error} /></View> : null}
          {lookup.places.map(place => <PlaceRow key={place.id} place={place} saved={isSaved(place.id)} reference={reference} onPress={() => choose(place)} />)}
          {!lookup.places.length && !lookup.searching ? (
            <View className="flex-row items-center gap-3 px-4 py-4">
              <Icon name="search-outline" size={20} color={colors.textSecondary} />
              <Text className="flex-1 text-sm leading-5 text-secondary">{lookup.policy === 'local-only' ? 'Nessuna corrispondenza locale. La ricerca online è disattivata.' : 'Nessuna corrispondenza. I dati possono essere incompleti.'}</Text>
            </View>
          ) : null}
          {lookup.policy === 'local-only' ? <Text className="px-4 pt-2 text-sm text-secondary">Solo ricerca locale</Text> : null}
        </View>
      )}
    </View>
  );
}
