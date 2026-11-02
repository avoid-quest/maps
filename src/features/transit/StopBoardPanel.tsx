import { useState, type ReactNode } from 'react';
import { TRANSITOUS_PRIVACY_NOTES } from '../../services/transitous';
import type { TransitousConsentSnapshot } from '../../services/transitous-consent';
import { ProviderBoardView, TransitousDisclosure } from './ProviderBoard';
import { transitousFallbackOffered } from './provider-board';
import type { ProviderBoardState } from './useProviderBoard';
import { ActivityIndicator, Switch, View } from 'react-native';
import { Text } from '../../ui/Text';
import type { Stop } from '../../domain/types';
import type { GttBoardRow } from '../../transit-data/board-model';
import { STOP_LIVE_DISCLOSURE, STOP_LIVE_SETTING } from '../../transit-data/stop-live';
import { transitAlertWarnings } from '../../domain/transit-alert-freshness';
import { useThemeColors } from '../../theme';
import { Button, Display, Divider, EmptyState, IconButton, Notice, Num, SectionHeader, TransitLineBadge, transitModeFromLineName, useHairlines } from '../../ui';
import { detailDistance } from '../map/distance-reference';
import { useDistanceReference } from '../map/useDistanceReference';
import { journeyDate, journeyTime } from '../planner/journey-presentation';
import { rowPresentation, rowStatusLines, visibleRows } from './departure-status';
import type { useStopBoard } from './useStopBoard';

type BoardState = ReturnType<typeof useStopBoard>;
export interface TransitousFallback {
  /** The board's online source is currently Transitous. */
  shown: boolean;
  consent: TransitousConsentSnapshot;
  board: ProviderBoardState;
  open(): void;
  close(): void;
  accept(): void;
}
export function StopBoardPanel({ stop, state, now, onLink, onDirections, actions, transitous }: {
  stop: Stop; state: BoardState; now: number; onLink: (url: string) => void; onDirections: () => void;
  /** Secondary stop actions shown as icons beside refresh, such as saving the stop. */
  actions?: ReactNode;
  /** Explicit "Cerca su Transitous" replacement of the online source. */
  transitous?: TransitousFallback;
}) {
  const [asking, setAsking] = useState(false);
  const reference = useDistanceReference();
  const distance = detailDistance(reference, stop.coordinate);
  const { board, alerts, arrivalsLoading, alertsLoading, arrivalsError, alertsError, refreshArrivals, refreshAlerts, schedules, updateSchedules, setSchedulesWifiOnly, setStopLive } = state;
  return <View className="gap-3">
    <View className="flex-row items-center gap-2 px-4">
      <Text accessibilityLabel={`Fermata ${stop.code}${distance ? `, ${distance.spoken}` : ''}`} className="flex-1 text-sm text-secondary">Fermata <Num className="text-sm text-primary">{stop.code}</Num>{distance ? <> · <Num className="text-sm text-secondary">{distance.label}</Num></> : null}</Text>
      {transitous?.shown ? null : <IconButton icon="refresh-outline" label="Aggiorna arrivi" disabled={arrivalsLoading} onPress={refreshArrivals} />}
      {actions}
    </View>
    {transitous?.shown ? <>
      <View className="gap-2 px-4">
        <Notice text="Fonte online sostituita da Transitous. Gli orari GTT sono nascosti per non mescolare le fonti." action="Torna a GTT" onAction={transitous.close} />
      </View>
      {!transitous.consent.accepted
        ? <View className="px-4"><TransitousDisclosure text={TRANSITOUS_PRIVACY_NOTES.stopFallback} onAccept={transitous.accept} onCancel={transitous.close} onLink={onLink} /></View>
        : <ProviderBoardView state={transitous.board} now={now} onLink={onLink} emptyTitle="Nessuna partenza da mostrare" />}
    </> : <>
    {schedules.phase === 'preparing' ? <BoardLoading label="Preparo gli orari GTT sul dispositivo…" /> : null}
    {arrivalsLoading ? <BoardLoading label={board ? 'Aggiorno il tempo reale…' : 'Cerco i prossimi passaggi…'} /> : null}
    {arrivalsError ? <View className="px-4"><Notice tone="danger" text={`${arrivalsError}${board ? ' Restano visibili gli orari programmati.' : ''}`} action="Riprova arrivi" onAction={refreshArrivals} /></View> : null}
    {transitous && transitousFallbackOffered(board, arrivalsError) ? <View className="gap-2 px-4">
      {asking && !transitous.consent.accepted
        ? <TransitousDisclosure text={TRANSITOUS_PRIVACY_NOTES.stopFallback} onAccept={() => { setAsking(false); transitous.accept(); transitous.open(); }} onCancel={() => setAsking(false)} onLink={onLink} />
        : <>
          <Text className="text-sm leading-5 text-secondary">Tempo reale GTT non disponibile per questa fermata. Puoi cercare le partenze su Transitous, un servizio esterno: le sue corse sostituiscono quelle GTT in questa bacheca.</Text>
          <View className="self-start"><Button variant="secondary" icon="search-outline" onPress={() => { if (transitous.consent.accepted) transitous.open(); else setAsking(true); }}>Cerca su Transitous</Button></View>
        </>}
    </View> : null}
    {board ? <>
      <Text className="px-4 text-sm leading-5 text-secondary">
        Orari programmati GTT <Num className="text-sm text-secondary">{board.schedule.feedVersion}</Num>{board.schedule.sourceUpdatedAt ? ` · fonte aggiornata il ${journeyDate(board.schedule.sourceUpdatedAt)}` : ''}
        {board.realtime.retrievedAt ? <> · tempo reale consultato alle <Num className="text-sm text-secondary">{journeyTime(board.realtime.retrievedAt)}</Num></> : null}
        {board.realtime.feedUpdatedAt ? <> (feed GTT delle <Num className="text-sm text-secondary">{journeyTime(board.realtime.feedUpdatedAt)}</Num>)</> : null}
        {board.realtime.retrievedAt && now - board.realtime.retrievedAt > 120_000 ? ' · Da aggiornare' : ''}
      </Text>
      {board.notices.map(notice => <View key={notice.code} className="px-4"><Notice tone="caution" text={notice.text}
        {...(notice.action && schedules.updateSupported ? { action: 'Aggiorna orari', onAction: updateSchedules } : {})} /></View>)}
      {visibleRows(board.rows, now).length ? <View>{visibleRows(board.rows, now).map(row => <DepartureRow key={row.id} row={row} now={now} />)}</View>
        : <EmptyState icon="time-outline" title="Nessun passaggio programmato" description="Nessuna corsa nelle prossime ore secondo gli orari installati." />}
      {board.attributions.map(attribution => <Text key={attribution} className="px-4 text-sm leading-5 text-secondary">{attribution}</Text>)}
    </> : null}
    </>}
    {schedules.updateSupported ? <View className="gap-3 px-4">
      <View className="self-start"><Button variant="secondary" icon="cloud-download-outline" disabled={schedules.checking} onPress={updateSchedules}>{schedules.checking ? 'Controllo orari…' : 'Aggiorna orari'}</Button></View>
      <SettingSwitch label="Aggiorna orari solo con Wi-Fi" value={schedules.refresh.wifiOnly} onChange={setSchedulesWifiOnly} />
      <SettingSwitch label={STOP_LIVE_SETTING} hint={STOP_LIVE_DISCLOSURE} value={schedules.refresh.stopLive} onChange={setStopLive} />
      <Text className="text-sm leading-5 text-secondary">{STOP_LIVE_DISCLOSURE}</Text>
      {schedules.lastOutcome ? <Text accessibilityLiveRegion="polite" className="text-sm leading-5 text-secondary">{SCHEDULE_OUTCOMES[schedules.lastOutcome]}{schedules.lastOutcome === 'failed' && schedules.lastError ? ` ${schedules.lastError}` : ''}</Text> : null}
    </View> : null}
    <Divider />
    <View>
      <View className="flex-row items-center pr-4">
        <View className="flex-1"><SectionHeader title="Avvisi di servizio" /></View>
        <IconButton icon="refresh-outline" label="Aggiorna avvisi" disabled={alertsLoading} onPress={refreshAlerts} />
      </View>
    </View>
    {alertsLoading ? <BoardLoading label={alerts ? 'Aggiorno gli avvisi…' : 'Cerco gli avvisi…'} /> : null}
    {alertsError ? <View className="px-4"><Notice tone="danger" text={`${alertsError}${alerts ? ' Avvisi conservati, validità non verificata.' : ''}`} action="Riprova avvisi" onAction={refreshAlerts} /></View> : null}
    {alerts ? <View className="gap-3 px-4">
      <Text className="text-sm leading-5 text-secondary">Avvisi consultati il {journeyDate(alerts.fetchedAt)} alle <Num className="text-sm text-secondary">{journeyTime(alerts.fetchedAt)}</Num> · {alerts.source}</Text>
      {now - alerts.fetchedAt > 300_000 && !alertsError ? <Notice tone="caution" text="Avvisi da aggiornare: la loro validità attuale non è verificata." /> : null}
      {transitAlertWarnings(alerts.sourceUpdatedAt, now, alerts.warnings).map((warning, index) => <Notice key={index} tone="caution" text={warning} />)}
      {alerts.alerts.length ? alerts.alerts.map(alert => <View key={alert.id} className="gap-1 rounded-2xl bg-caution-subtle p-4">
        <Text className="text-base font-semibold text-primary">{alert.title}</Text>
        <Text className="text-sm leading-5 text-primary">{alert.description}</Text>
        {alert.url ? <View className="self-start"><Button variant="quiet" role="link" icon="open-outline" onPress={() => onLink(alert.url!)}>Dettagli avviso</Button></View> : null}
      </View>) : <Text className="text-sm leading-5 text-secondary">Nessun avviso alla consultazione.</Text>}
    </View> : null}
    <View className="px-4 pt-2"><Button variant="secondary" icon="walk-outline" onPress={onDirections}>Raggiungi la fermata</Button></View>
  </View>;
}
function BoardLoading({ label }: { label: string }) {
  const colors = useThemeColors();
  return <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3 px-4 py-2"><ActivityIndicator color={colors.action} /><Text className="flex-1 text-sm text-secondary">{label}</Text></View>;
}

const SCHEDULE_OUTCOMES = {
  current: 'Orari già aggiornati.', installed: 'Nuovi orari installati.', 'not-modified': 'Nessun nuovo orario pubblicato.',
  'outdated-manifest': 'Nessun orario più recente disponibile.', rejected: 'Pacchetto orari non valido: mantenuti gli orari attuali.',
  failed: 'Controllo orari non riuscito: mantenuti gli orari attuali.', 'skipped-network': 'Aggiornamento orari in attesa del Wi-Fi.',
  throttled: 'Orari controllati di recente.',
} as const;

function SettingSwitch({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void }) {
  const colors = useThemeColors();
  return <View className="min-h-12 flex-row items-center justify-between gap-3">
    <Text className="flex-1 text-base text-primary">{label}</Text>
    <Switch accessibilityLabel={label} accessibilityHint={hint} value={value} onValueChange={onChange}
      trackColor={{ true: colors.action, false: colors.surfaceMuted }} thumbColor={value ? colors.onAction : colors.textSecondary} />
  </View>;
}

/** Text colour for a row's written state; the state is always spelled out, never carried by colour alone. */
function stateClass(row: GttBoardRow, live: boolean): string {
  if (row.realtimeState === 'cancelled') return 'text-cancelled font-semibold';
  if (live) return 'text-live';
  if (row.gtt.realtime === 'stale') return 'text-stale';
  return 'text-scheduled';
}

/**
 * A departure-board row: line badge · destination, written state, provenance and note · right-aligned time.
 * Live countdowns are large Mona Sans in signal green; clock times are Geist Mono.
 */
function DepartureRow({ row, now }: { row: GttBoardRow; now: number }) {
  const hairlines = useHairlines();
  const view = rowPresentation(row, now);
  const lines = rowStatusLines(view);
  const countdown = view.live ? /^(\d+) min$/.exec(view.timeText)?.[1] : undefined;
  // Colour follows the aged row, the same one the written state describes.
  const tone = stateClass(view.row, view.live);
  const line = row.line ?? '—';
  const spokenTime = view.timeText === '—' ? '' : countdown != null ? `tra ${countdown} ${countdown === '1' ? 'minuto' : 'minuti'}` : /^\d|^~/.test(view.timeText) ? `alle ${view.timeText.replace('~', 'circa ')}` : view.timeText;
  return <View accessible accessibilityLabel={`${row.line ? `Linea ${row.line}` : 'Linea non indicata'}, ${row.headsign || 'direzione non indicata'}, ${lines.status ? `${lines.status}, ` : ''}${lines.provenance}${spokenTime ? `, ${spokenTime}` : ''}${view.note ? `. ${view.note}` : ''}`}
    style={hairlines.bottom} className="min-h-16 flex-row items-center gap-3 px-4 py-3">
    <TransitLineBadge line={line} mode={row.line ? transitModeFromLineName(row.line) : undefined} />
    <View className="min-w-0 flex-1">
      <Text numberOfLines={2} className="text-base font-medium leading-5 text-primary">{row.headsign || 'Direzione non indicata'}</Text>
      {lines.status ? <Text className={`mt-0.5 text-sm ${tone}`}>{lines.status}</Text> : null}
      <Text className="mt-0.5 text-sm text-secondary">{lines.provenance}</Text>
      {view.note ? <Text className="mt-0.5 text-sm leading-5 text-secondary">{view.note}</Text> : null}
    </View>
    <View className="min-w-14 flex-row items-baseline justify-end gap-1">
      {countdown != null ? <>
        <Display size={30} className="text-live">{countdown}</Display>
        <Num className="text-sm text-live">min</Num>
      </> : <Num className={`text-xl ${tone}`}>{view.timeText}</Num>}
    </View>
  </View>;
}
