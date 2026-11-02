import { View } from 'react-native';
import { TRANSITOUS_PRIVACY_NOTES } from '../../services/transitous';
import type { RailPilotStation } from '../../services/transitous-stations';
import { Num, SegmentedControl, Text } from '../../ui';
import { useFeedback } from '../app/feedback';
import { detailDistance } from '../map/distance-reference';
import { useDistanceReference } from '../map/useDistanceReference';
import { ProviderBoardView, TransitousDisclosure } from './ProviderBoard';
import { useTransitContext } from './useTransit';

const EVENTS = [{ value: 'departure' as const, label: 'Partenze' }, { value: 'arrival' as const, label: 'Arrivi' }];

/** A pilot rail station: departures or arrivals from Transitous, after its disclosure. */
export function RailStationSheet({ station, now }: { station: RailPilotStation; now: number }) {
  const transit = useTransitContext();
  const { openLink } = useFeedback();
  const reference = useDistanceReference();
  const distance = detailDistance(reference, station.coordinate);
  const { rail, consent } = transit;
  return <View className="gap-3 py-1">
    <View className="gap-3 px-4">
      <Text accessibilityLabel={`Stazione ferroviaria${distance ? `, ${distance.spoken}` : ''}`} className="text-sm text-secondary">
        Stazione ferroviaria{distance ? <> · <Num className="text-sm text-secondary">{distance.label}</Num></> : null}
      </Text>
      <SegmentedControl accessibilityLabel="Partenze o arrivi" options={EVENTS} value={rail.event} onChange={rail.setEvent} />
    </View>
    {!consent.ready ? null : !consent.accepted
      ? <View className="px-4"><TransitousDisclosure text={TRANSITOUS_PRIVACY_NOTES.railBoard} onAccept={transit.acceptTransitous} onLink={openLink} /></View>
      : <ProviderBoardView state={rail.board} now={now} onLink={openLink} emptyTitle={rail.event === 'arrival' ? 'Nessun arrivo da mostrare' : 'Nessuna partenza da mostrare'} />}
    <Text className="px-4 text-sm leading-5 text-secondary">Treni e bus Trenitalia della stazione. Gli orari “dichiarati in tempo reale” non indicano quando la fonte li ha aggiornati. Verifica sempre i monitor in stazione.</Text>
  </View>;
}
