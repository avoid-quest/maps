import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { Stop } from '../domain/types';
import type { GttBoardRow } from '../transit-data/board-model';
import { STOP_LIVE_DISCLOSURE, STOP_LIVE_SETTING } from '../transit-data/stop-live';
import { colors } from '../theme/tokens';
import { Button, EmptyState, IconButton, Notice } from './Controls';
import { rowPresentation } from './departure-status';
import { transitAlertWarnings } from '../domain/transit-alert-freshness';
import { journeyDate, journeyDistance, journeyTime } from './journey-presentation';
import type { useStopBoard } from './useStopBoard';

type BoardState = ReturnType<typeof useStopBoard>;
export function StopBoardPanel({ stop, state, now, onLink, onDirections }: {
  stop: Stop; state: BoardState; now: number; onLink: (url: string) => void; onDirections: () => void;
}) {
  const { board, alerts, arrivalsLoading, alertsLoading, arrivalsError, alertsError, refreshArrivals, refreshAlerts, schedules, updateSchedules, setSchedulesWifiOnly, setStopLive } = state;
  return <View className="gap-4">
    <View className="flex-row items-center justify-between">
      <Text className="flex-1 text-sm text-[#59667A]">Fermata {stop.code}{stop.distanceMeters ? ` · ${journeyDistance(stop.distanceMeters)}` : ''}</Text>
      <IconButton icon="refresh-outline" label="Aggiorna arrivi" disabled={arrivalsLoading} onPress={refreshArrivals} />
    </View>
    {schedules.phase === 'preparing' ? <BoardLoading label="Preparo gli orari GTT sul dispositivo…" /> : null}
    {arrivalsLoading ? <BoardLoading label={board ? 'Aggiorno il tempo reale…' : 'Cerco i prossimi passaggi…'} /> : null}
    {arrivalsError ? <Notice danger text={`${arrivalsError}${board ? ' Restano visibili gli orari programmati.' : ''}`} action="Riprova arrivi" onAction={refreshArrivals} /> : null}
    {board ? <>
      <Text className="text-xs leading-5 text-[#59667A]">
        Orari programmati GTT {board.schedule.feedVersion}{board.schedule.sourceUpdatedAt ? ` · fonte aggiornata il ${journeyDate(board.schedule.sourceUpdatedAt)}` : ''}
        {board.realtime.retrievedAt ? ` · tempo reale consultato alle ${journeyTime(board.realtime.retrievedAt)}` : ''}
        {board.realtime.feedUpdatedAt ? ` (feed GTT delle ${journeyTime(board.realtime.feedUpdatedAt)})` : ''}
        {board.realtime.retrievedAt && now - board.realtime.retrievedAt > 120_000 ? ' · Da aggiornare' : ''}
      </Text>
      {board.notices.map(notice => <Notice key={notice.code} text={notice.text}
        {...(notice.action && schedules.updateSupported ? { action: 'Aggiorna orari', onAction: updateSchedules } : {})} />)}
      {board.rows.length ? board.rows.map(row => <DepartureRow key={row.id} row={row} now={now} />)
        : <EmptyState icon="time-outline" title="Nessun passaggio programmato" description="Nessuna corsa nelle prossime ore secondo gli orari installati." />}
      {board.attributions.map(attribution => <Text key={attribution} className="text-xs leading-5 text-[#59667A]">{attribution}</Text>)}
    </> : null}
    {schedules.updateSupported ? <View className="flex-row flex-wrap items-center gap-3">
      <Button secondary icon="cloud-download-outline" disabled={schedules.checking} onPress={updateSchedules}>{schedules.checking ? 'Controllo orari…' : 'Aggiorna orari'}</Button>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: schedules.refresh.wifiOnly }} className="min-h-11 justify-center" onPress={() => setSchedulesWifiOnly(!schedules.refresh.wifiOnly)}>
        <Text className="text-sm text-[#2359D7]">Aggiorna orari solo con Wi-Fi: {schedules.refresh.wifiOnly ? 'sì' : 'no'}</Text>
      </Pressable>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: schedules.refresh.stopLive }} accessibilityHint={STOP_LIVE_DISCLOSURE} className="min-h-11 justify-center" onPress={() => setStopLive(!schedules.refresh.stopLive)}>
        <Text className="text-sm text-[#2359D7]">{STOP_LIVE_SETTING}: {schedules.refresh.stopLive ? 'sì' : 'no'}</Text>
      </Pressable>
      <Text className="text-xs leading-5 text-[#59667A]">{STOP_LIVE_DISCLOSURE}</Text>
      {schedules.lastOutcome ? <Text className="text-xs text-[#59667A]">{SCHEDULE_OUTCOMES[schedules.lastOutcome]}{schedules.lastOutcome === 'failed' && schedules.lastError ? ` ${schedules.lastError}` : ''}</Text> : null}
    </View> : null}
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
const SCHEDULE_OUTCOMES = {
  current: 'Orari già aggiornati.', installed: 'Nuovi orari installati.', 'not-modified': 'Nessun nuovo orario pubblicato.',
  'outdated-manifest': 'Nessun orario più recente disponibile.', rejected: 'Pacchetto orari non valido: mantenuti gli orari attuali.',
  failed: 'Controllo orari non riuscito: mantenuti gli orari attuali.', 'skipped-network': 'Aggiornamento orari in attesa del Wi-Fi.',
  throttled: 'Orari controllati di recente.',
} as const;
function DepartureRow({ row, now }: { row: GttBoardRow; now: number }) {
  const view = rowPresentation(row, now);
  return <View className="flex-row items-center gap-3 border-b border-[#E2E8F0] py-3">
    <View className="min-w-12 items-center rounded-xl bg-[#17243C] px-2 py-3"><Text className="font-bold text-white">{row.line}</Text></View>
    <View className="flex-1">
      <Text className="font-semibold leading-5 text-[#17243C]">{row.headsign || 'Direzione non indicata'}</Text>
      <Text className={`mt-1 text-xs ${view.live ? 'text-[#167469]' : 'text-[#59667A]'}`}>{view.statusText}</Text>
      <Text className="mt-1 text-xs text-[#59667A]">{view.provenance}</Text>
    </View>
    <Text className={`text-lg font-bold ${view.live ? 'text-[#167469]' : 'text-[#59667A]'}`}>{view.timeText}</Text>
  </View>;
}
