import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Departure, Stop } from '../../domain/types';
import { transitAlertWarnings } from '../../domain/transit-alert-freshness';
import { useThemeColors } from '../../theme';
import { Button, EmptyState, IconButton, Notice, SectionHeader, TransitLineBadge, transitModeFromLineName } from '../../ui';
import { journeyDate, journeyDistance, journeyTime } from '../planner/journey-presentation';
import { displayedDepartureStatus } from './departure-status';
import type { useStopBoard } from './useStopBoard';

type BoardState = ReturnType<typeof useStopBoard>;
export function StopBoardPanel({ stop, state, now, onLink, onDirections, actions }: {
  stop: Stop; state: BoardState; now: number; onLink: (url: string) => void; onDirections: () => void;
  /** Secondary stop actions shown as icons beside refresh, such as saving the stop. */
  actions?: ReactNode;
}) {
  const { board, alerts, arrivalsLoading, alertsLoading, arrivalsError, alertsError, refreshArrivals, refreshAlerts } = state;
  return <View className="gap-3">
    <View className="flex-row items-center gap-2 px-4">
      <Text className="flex-1 text-sm text-secondary">Fermata {stop.code}{stop.distanceMeters ? ` · ${journeyDistance(stop.distanceMeters)}` : ''}</Text>
      <IconButton icon="refresh-outline" label="Aggiorna arrivi" disabled={arrivalsLoading} onPress={refreshArrivals} />
      {actions}
    </View>
    {arrivalsLoading ? <BoardLoading label={board ? 'Aggiorno gli arrivi…' : 'Cerco i prossimi arrivi…'} /> : null}
    {arrivalsError ? <View className="px-4"><Notice tone="danger" text={`${arrivalsError}${board ? ' Ultimi arrivi conservati.' : ''}`} action="Riprova arrivi" onAction={refreshArrivals} /></View> : null}
    {board ? <>
      <Text className="px-4 text-sm leading-5 text-secondary">Arrivi consultati il {journeyDate(board.fetchedAt)} alle {journeyTime(board.fetchedAt)} · {board.source}{now - board.fetchedAt > 120_000 ? ' · Da aggiornare' : ''}</Text>
      {board.warnings.map((warning, index) => <View key={index} className="px-4"><Notice tone="caution" text={warning} /></View>)}
      {board.departures.length ? <View>{board.departures.map(departure => <DepartureRow key={departure.id} departure={departure} now={now} feedUpdatedAt={board.sourceUpdatedAt} />)}</View>
        : <EmptyState icon="time-outline" title="Nessun arrivo disponibile" description="Riprova tra poco o scegli un’altra fermata." />}
    </> : null}
    <View className="border-t border-divider pt-1">
      <View className="flex-row items-center pr-4">
        <View className="flex-1"><SectionHeader title="Avvisi di servizio" /></View>
        <IconButton icon="refresh-outline" label="Aggiorna avvisi" disabled={alertsLoading} onPress={refreshAlerts} />
      </View>
    </View>
    {alertsLoading ? <BoardLoading label={alerts ? 'Aggiorno gli avvisi…' : 'Cerco gli avvisi…'} /> : null}
    {alertsError ? <View className="px-4"><Notice tone="danger" text={`${alertsError}${alerts ? ' Avvisi conservati, validità non verificata.' : ''}`} action="Riprova avvisi" onAction={refreshAlerts} /></View> : null}
    {alerts ? <View className="gap-3 px-4">
      <Text className="text-sm leading-5 text-secondary">Avvisi consultati il {journeyDate(alerts.fetchedAt)} alle {journeyTime(alerts.fetchedAt)} · {alerts.source}</Text>
      {now - alerts.fetchedAt > 300_000 && !alertsError ? <Notice tone="caution" text="Avvisi da aggiornare: la loro validità attuale non è verificata." /> : null}
      {transitAlertWarnings(alerts.sourceUpdatedAt, now, alerts.warnings).map((warning, index) => <Notice key={index} tone="caution" text={warning} />)}
      {alerts.alerts.length ? alerts.alerts.map(alert => <View key={alert.id} className="gap-1 rounded-2xl bg-caution-subtle p-4">
        <Text className="text-base font-semibold text-primary">{alert.title}</Text>
        <Text className="text-sm leading-5 text-primary">{alert.description}</Text>
        {alert.url ? <View className="self-start"><Button variant="quiet" icon="open-outline" onPress={() => onLink(alert.url!)}>Dettagli avviso</Button></View> : null}
      </View>) : <Text className="text-sm leading-5 text-secondary">Nessun avviso alla consultazione.</Text>}
    </View> : null}
    <View className="px-4 pt-2"><Button variant="secondary" icon="walk-outline" onPress={onDirections}>Raggiungi la fermata</Button></View>
  </View>;
}
function BoardLoading({ label }: { label: string }) {
  const colors = useThemeColors();
  return <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3 px-4 py-2"><ActivityIndicator color={colors.action} /><Text className="flex-1 text-sm text-secondary">{label}</Text></View>;
}

const statusLabels: Record<Departure['status'], string> = { live: 'Tempo reale', scheduled: 'Da orario', stale: 'Da aggiornare', cancelled: 'Corsa cancellata', unknown: 'Orario non disponibile' };
const statusText: Record<Departure['status'], string> = { live: 'text-live', scheduled: 'text-scheduled', stale: 'text-stale', cancelled: 'text-cancelled', unknown: 'text-secondary' };

/** Line identity, direction, a labelled data state and a large time, so the board reads at a glance. */
function DepartureRow({ departure, now, feedUpdatedAt }: { departure: Departure; now: number; feedUpdatedAt?: number }) {
  const at = departure.expectedAt ?? departure.scheduledAt;
  const status = displayedDepartureStatus(departure, feedUpdatedAt, now);
  const minutes = status === 'live' && at != null && at >= now ? Math.max(0, Math.ceil((at - now) / 60000)) : null;
  const time = status === 'cancelled' || at == null ? '—' : minutes != null ? String(minutes) : journeyTime(at);
  const spokenTime = status === 'cancelled' ? '' : at == null ? 'orario non disponibile' : minutes != null ? `tra ${minutes} minuti` : `alle ${journeyTime(at)}`;
  return <View accessible accessibilityLabel={`Linea ${departure.line}, ${departure.headsign || 'direzione non indicata'}, ${statusLabels[status]}${spokenTime ? `, ${spokenTime}` : ''}`}
    className="min-h-16 flex-row items-center gap-3 border-b border-divider px-4 py-3">
    <TransitLineBadge line={departure.line} mode={transitModeFromLineName(departure.line)} />
    <View className="min-w-0 flex-1">
      <Text numberOfLines={2} className="text-base font-medium leading-5 text-primary">{departure.headsign || 'Direzione non indicata'}</Text>
      <Text className={`mt-0.5 text-sm ${statusText[status]} ${status === 'cancelled' ? 'font-semibold' : ''}`}>{statusLabels[status]}</Text>
    </View>
    <View className="min-w-14 items-end">
      <Text style={{ fontVariant: ['tabular-nums'] }} className={`text-2xl font-bold ${statusText[status]}`}>{time}</Text>
      {minutes != null ? <Text className="text-sm text-live">min</Text> : null}
    </View>
  </View>;
}
