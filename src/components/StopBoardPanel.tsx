import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { Departure, Stop } from '../domain/types';
import { colors } from '../theme/tokens';
import { Button, EmptyState, IconButton, Notice } from './Controls';
import { displayedDepartureStatus } from './departure-status';
import { transitAlertWarnings } from '../domain/transit-alert-freshness';
import { journeyDate, journeyDistance, journeyTime } from './journey-presentation';
import type { useStopBoard } from './useStopBoard';

type BoardState = ReturnType<typeof useStopBoard>;
export function StopBoardPanel({ stop, state, now, onLink, onDirections }: {
  stop: Stop; state: BoardState; now: number; onLink: (url: string) => void; onDirections: () => void;
}) {
  const { board, alerts, arrivalsLoading, alertsLoading, arrivalsError, alertsError, refreshArrivals, refreshAlerts } = state;
  return <View className="gap-4">
    <View className="flex-row items-center justify-between">
      <Text className="flex-1 text-sm text-[#59667A]">Fermata {stop.code}{stop.distanceMeters ? ` · ${journeyDistance(stop.distanceMeters)}` : ''}</Text>
      <IconButton icon="refresh-outline" label="Aggiorna arrivi" disabled={arrivalsLoading} onPress={refreshArrivals} />
    </View>
    {arrivalsLoading ? <BoardLoading label={board ? 'Aggiorno gli arrivi…' : 'Cerco i prossimi arrivi…'} /> : null}
    {arrivalsError ? <Notice danger text={`${arrivalsError}${board ? ' Ultimi arrivi conservati.' : ''}`} action="Riprova arrivi" onAction={refreshArrivals} /> : null}
    {board ? <>
      <Text className="text-xs leading-5 text-[#59667A]">Arrivi consultati il {journeyDate(board.fetchedAt)} alle {journeyTime(board.fetchedAt)} · {board.source}{now - board.fetchedAt > 120_000 ? ' · Da aggiornare' : ''}</Text>
      {board.warnings.map((warning, index) => <Notice key={index} text={warning} />)}
      {board.departures.length ? board.departures.map(departure => <DepartureRow key={departure.id} departure={departure} now={now} feedUpdatedAt={board.sourceUpdatedAt} />)
        : <EmptyState icon="time-outline" title="Nessun arrivo disponibile" description="Riprova tra poco o scegli un’altra fermata." />}
    </> : null}
    <View className="flex-row items-center justify-between border-t border-[#E2E8F0] pt-3">
      <Text className="text-base font-semibold text-[#17243C]">Avvisi di servizio</Text>
      <IconButton icon="refresh-outline" label="Aggiorna avvisi" disabled={alertsLoading} onPress={refreshAlerts} />
    </View>
    {alertsLoading ? <BoardLoading label={alerts ? 'Aggiorno gli avvisi…' : 'Cerco gli avvisi…'} /> : null}
    {alertsError ? <Notice danger text={`${alertsError}${alerts ? ' Avvisi conservati, validità non verificata.' : ''}`} action="Riprova avvisi" onAction={refreshAlerts} /> : null}
    {alerts ? <>
      <Text className="text-xs leading-5 text-[#59667A]">Avvisi consultati il {journeyDate(alerts.fetchedAt)} alle {journeyTime(alerts.fetchedAt)} · {alerts.source}</Text>
      {now - alerts.fetchedAt > 300_000 && !alertsError ? <Notice text="Avvisi da aggiornare: la loro validità attuale non è verificata." /> : null}
      {transitAlertWarnings(alerts.sourceUpdatedAt, now, alerts.warnings).map((warning, index) => <Notice key={index} text={warning} />)}
      {alerts.alerts.length ? alerts.alerts.map(alert => <View key={alert.id} className="rounded-2xl bg-[#FFF5DE] p-4">
        <Text className="font-semibold text-[#17243C]">{alert.title}</Text>
        <Text className="mt-2 text-sm leading-5 text-[#59667A]">{alert.description}</Text>
        {alert.url ? <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => onLink(alert.url!)}>
          <Text className="font-semibold text-[#2359D7]">Dettagli avviso</Text>
        </Pressable> : null}
      </View>) : <Text className="text-sm leading-5 text-[#59667A]">Nessun avviso alla consultazione.</Text>}
    </> : null}
    <Button secondary icon="walk-outline" onPress={onDirections}>Raggiungi la fermata</Button>
  </View>;
}
function BoardLoading({ label }: { label: string }) {
  return <View className="flex-row items-center gap-3 py-2"><ActivityIndicator color={colors.blue} /><Text className="flex-1 text-sm text-[#59667A]">{label}</Text></View>;
}
function DepartureRow({ departure, now, feedUpdatedAt }: { departure: Departure; now: number; feedUpdatedAt?: number }) {
  const at = departure.expectedAt ?? departure.scheduledAt;
  const status = displayedDepartureStatus(departure, feedUpdatedAt, now);
  const labels = { live: 'Tempo reale', scheduled: 'Da orario', stale: 'Da aggiornare', cancelled: 'Corsa cancellata', unknown: 'Orario non disponibile' };
  return <View className="flex-row items-center gap-3 border-b border-[#E2E8F0] py-3">
    <View className="min-w-12 items-center rounded-xl bg-[#17243C] px-2 py-3"><Text className="font-bold text-white">{departure.line}</Text></View>
    <View className="flex-1">
      <Text className="font-semibold leading-5 text-[#17243C]">{departure.headsign || 'Direzione non indicata'}</Text>
      <Text className={`mt-1 text-xs ${status === 'live' ? 'text-[#167469]' : 'text-[#59667A]'}`}>{labels[status]}</Text>
    </View>
    <Text className={`text-lg font-bold ${status === 'live' ? 'text-[#167469]' : 'text-[#59667A]'}`}>{status === 'cancelled' ? '—' : at ? status === 'live' && at >= now ? `${Math.max(0, Math.ceil((at - now) / 60000))} min` : journeyTime(at) : '—'}</Text>
  </View>;
}
