import { ActivityIndicator, Linking, ScrollView, useWindowDimensions, View } from 'react-native';
import type { TransitConfirmation } from '../../domain/navigation';
import { navigationLocationForReplan } from '../../domain/navigation';
import { useThemeColors } from '../../theme';
import { Button, Display, IconButton, Notice, Num, Text, TransitLineBadge, transitModeFromLineName, useHairlines } from '../../ui';
import { transitModeFromLeg } from '../../ui/transit-line';
import { useNow } from '../app/useNow';
import { journeyTime } from '../planner/journey-presentation';
import { JourneyTimeline } from '../planner/TransitJourney';
import type { useStopBoard } from '../transit/useStopBoard';
import type { NavigationState } from './navigation-controller';
import { currentStepKey, liveBoarding, sessionPlan, transitFollowModel, type LiveBoarding } from './transit-follow';
import type { RouteLeg, Stop } from '../../domain/types';

const LIVE_TONE: Record<LiveBoarding['tone'], string> = {
  live: 'text-live', scheduled: 'text-scheduled', caution: 'text-caution', disruption: 'text-cancelled font-semibold', neutral: 'text-secondary',
};
export const FOLLOW_ACTIONS_HEIGHT = 80;

/**
 * Following a transit journey: what to do now, the next boarding with its live provenance, and one
 * large confirmation beside Stop. Nothing here needs a position fix; GPS distance is advisory only.
 */
export function TransitFollowPanel({ state, following, follow, onRecenter, onStop, onRetry, onConfirm, onReplan }: {
  state: NavigationState; following: boolean;
  follow: { leg: RouteLeg | null; stop: Stop | null; board: ReturnType<typeof useStopBoard> };
  onRecenter: () => void; onStop: () => void; onRetry: () => void; onConfirm: (action: TransitConfirmation) => void; onReplan: () => void;
}) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const { height, fontScale } = useWindowDimensions();
  // Passed/missed times are re-evaluated at least every 15 s, as the native contract requires.
  const now = useNow(15_000);
  const { snapshot, busy, error } = state;
  const starting = busy === 'start' && snapshot.mode !== 'transit';
  const model = transitFollowModel(starting ? { ...snapshot, transit: undefined, instruction: undefined } : snapshot, state.transitPlan, now);
  const plan = sessionPlan(snapshot, state.transitPlan);
  const terminal = model.stage === 'arrived' || model.stage === 'ended';
  const replanLocation = navigationLocationForReplan(snapshot);
  const showReplan = !terminal && !starting && (model.stale || !!model.warning || snapshot.problem === 'transit-replan-needed');
  // Same geometry as road guidance, so the map attribution below it stays in place.
  const headerHeight = Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5));
  const live = follow.leg && model.boarding?.leg === follow.leg
    ? liveBoarding({ leg: follow.leg, rows: follow.board.board?.rows ?? null, boardAvailable: !!follow.stop, loading: follow.board.arrivalsLoading || follow.board.schedules.phase === 'preparing', error: follow.board.arrivalsError, now })
    : null;
  return <View pointerEvents="box-none" className="flex-1">
    <View testID="transit-follow-instruction" style={{ height: headerHeight, backgroundColor: colors.chrome, ...hairlines.bottom }} className="gap-1 px-4 py-3">
      <View className="flex-row items-center gap-2">
        {starting ? <ActivityIndicator color={colors.textPrimary} /> : null}
        <Display accessibilityRole="header" accessibilityLiveRegion="polite" size={26} className="flex-1 text-primary">{model.title}</Display>
        {model.progress ? <Num className="text-sm text-secondary">{model.progress}</Num> : null}
      </View>
      <Text numberOfLines={2} className="text-base leading-6 text-primary">{model.instruction}</Text>
    </View>
    <View pointerEvents="box-none" className="flex-1">
      <View style={{ position: 'absolute', right: 12, top: 48 }}>
        <IconButton floating icon="locate-outline" label="Ricentra sulla mia posizione" active={following} disabled={!snapshot.location} onPress={onRecenter} />
      </View>
    </View>
    <View testID="transit-follow-sheet" style={[{ height: Math.min(height * 0.56, Math.max(300, height - headerHeight - 160)) }, hairlines.top]} className="rounded-t-3xl bg-surface">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 12 }}>
        {model.warning ? <Notice tone="danger" text={model.warning} /> : null}
        {error ? <Notice tone="danger" text={error} /> : null}
        {snapshot.problem === 'transit-replan-needed' && !model.warning ? <Notice tone="danger" text="Viaggio da aggiornare. Scegli un nuovo percorso." /> : null}
        {model.boarding ? <BoardingCard model={model} live={live} stop={follow.stop} /> : null}
        {model.alighting ? <View className="gap-0.5">
          <Text className="text-sm font-semibold text-secondary">Scendi a</Text>
          <Text className="text-lg font-semibold leading-6 text-primary">{model.alighting.stopName ?? 'Fermata non indicata'}</Text>
          {model.alighting.arrivalAt ? <Text className="text-sm text-secondary">Arrivo previsto alle <Num className="text-sm text-secondary">{journeyTime(model.alighting.arrivalAt)}</Num> · dal piano MATO</Text> : null}
        </View> : null}
        {model.proximity ? <Text testID="transit-follow-proximity" className="text-sm leading-5 text-secondary">{model.proximity}</Text> : null}
        <Text className={`text-sm leading-5 ${model.stale ? 'text-caution' : 'text-secondary'}`}>{model.age}{model.stale ? ' · da aggiornare' : ''}</Text>
        {showReplan ? <View className="self-start"><Button variant="secondary" icon="refresh-outline" disabled={!!busy} onPress={onReplan}>{replanLocation ? 'Ricalcola dalla mia posizione' : 'Aggiorna il viaggio'}</Button></View> : null}
        {!terminal && snapshot.sessionId && !snapshot.notificationGranted ? <Notice text="Notifiche disattivate: interrompi il viaggio da qui." action="Apri impostazioni" onAction={() => { void Linking.openSettings(); }} /> : null}
        {model.stage === 'arrived' ? <Text className="text-base leading-6 text-primary">Viaggio terminato. Verifica l’ingresso sul posto.</Text> : null}
        {plan && !terminal ? <View>
          <Text accessibilityRole="header" className="pb-2 text-base font-semibold text-primary">Il tuo viaggio</Text>
          <JourneyTimeline plan={plan} now={now} stale={model.stale} currentKey={currentStepKey(snapshot, plan)} />
        </View> : null}
        <Text className="text-sm leading-5 text-secondary">MATO / 5T · la posizione non conferma salita e discesa: conferma tu ogni passaggio. Corse non monitorate automaticamente.</Text>
      </ScrollView>
      <View style={[{ minHeight: FOLLOW_ACTIONS_HEIGHT }, hairlines.top]} className="flex-row items-center gap-2 px-4 py-3">
        {terminal ? <>
          {model.stage === 'ended' && snapshot.canRetry ? <View className="min-w-0 flex-1"><Button icon="play-outline" loading={busy === 'retry'} disabled={!!busy} onPress={onRetry}>{snapshot.status === 'interrupted' ? 'Riprendi' : 'Riprova'}</Button></View> : null}
          <View className="min-w-0 flex-1"><Button variant={model.stage === 'ended' && snapshot.canRetry ? 'secondary' : 'primary'} icon="close-outline" loading={busy === 'stop'} onPress={onStop}>Chiudi</Button></View>
        </> : <>
          <View style={{ flex: 2 }} className="min-w-0">
            {model.action ? <Button icon={model.action.confirm === 'board' ? 'enter-outline' : model.action.confirm === 'alight' ? 'exit-outline' : 'checkmark-outline'} loading={busy === 'confirm'} disabled={!!busy}
              accessibilityHint="Conferma il passaggio: la posizione non lo rileva da sola" onPress={() => onConfirm(model.action!.confirm)}>{model.action.label}</Button>
              : <Button disabled onPress={() => undefined}>{starting ? 'Avvio…' : 'In attesa'}</Button>}
          </View>
          <View style={{ flex: 1 }} className="min-w-0"><Button variant="secondary" icon="stop-circle-outline" loading={busy === 'stop'} onPress={onStop}>Stop</Button></View>
        </>}
      </View>
    </View>
  </View>;
}

function BoardingCard({ model, live, stop }: { model: ReturnType<typeof transitFollowModel>; live: LiveBoarding | null; stop: Stop | null }) {
  const boarding = model.boarding!;
  const mode = boarding.leg ? transitModeFromLeg(boarding.leg.mode) : boarding.line ? transitModeFromLineName(boarding.line) : undefined;
  const countdown = live?.live ? /^(\d+) min$/.exec(live.timeText ?? '')?.[1] : undefined;
  const planned = boarding.departureAt != null ? journeyTime(boarding.departureAt) : undefined;
  return <View testID="transit-follow-boarding" className="gap-2">
    <Text className="text-sm font-semibold text-secondary">{boarding.role === 'connection' ? 'Coincidenza' : 'Prossima partenza'}</Text>
    <View className="flex-row items-start gap-3">
      <View className="min-w-0 flex-1 gap-1.5">
        <View className="flex-row flex-wrap items-center gap-2">
          {boarding.line ? <TransitLineBadge line={boarding.line} mode={mode} size="lg" /> : null}
          <Text className="min-w-0 shrink text-base font-medium leading-5 text-primary">{boarding.headsign ? `Direzione ${boarding.headsign}` : 'Direzione non fornita'}</Text>
        </View>
        {boarding.stopName ? <Text className="text-base leading-6 text-primary">{boarding.stopName}
          {boarding.stopCode ? <Text className="text-sm text-secondary"> · fermata <Num className="text-sm text-secondary">{boarding.stopCode}</Num></Text> : null}
          {boarding.platform ? <Text className="text-sm text-secondary"> · banchina <Num className="text-sm text-secondary">{boarding.platform}</Num></Text> : null}
        </Text> : null}
      </View>
      <View className="min-w-16 items-end">
        {countdown != null ? <View className="flex-row items-baseline gap-1"><Display size={34} className="text-live">{countdown}</Display><Num className="text-sm text-live">min</Num></View>
          : live?.state === 'matched' && live.timeText ? <Num className={`text-2xl ${LIVE_TONE[live.tone]}`}>{live.timeText}</Num>
            : planned ? <Num className="text-2xl text-primary">{planned}</Num> : null}
      </View>
    </View>
    {live ? <View accessibilityLiveRegion="polite" className="gap-0.5">
      {live.status ? <Text className={`text-sm font-semibold ${LIVE_TONE[live.tone]}`}>{live.status}</Text> : null}
      <Text className="text-sm leading-5 text-secondary">{live.provenance}{live.state === 'matched' && stop ? <> · fermata <Num className="text-sm text-secondary">{stop.code}</Num></> : null}</Text>
      {live.note ? <Text className="text-sm leading-5 text-secondary">{live.note}</Text> : null}
      {live.sameLine?.length ? <View className="gap-0.5 pt-1">
        <Text className="text-sm font-semibold text-secondary">Altri passaggi della linea {boarding.line} a questa fermata</Text>
        {live.sameLine.map(item => <Text key={item.id} className="text-sm leading-5 text-secondary"><Num className={`text-sm ${item.live ? 'text-live' : 'text-secondary'}`}>{item.time}</Num> · {item.provenance}</Text>)}
      </View> : null}
      {live.state !== 'matched' && planned ? <Text className="text-sm leading-5 text-secondary">Nel piano: <Num className="text-sm text-secondary">{planned}</Num> · {boarding.leg?.timingStatus === 'prediction' ? 'Previsione MATO' : boarding.leg?.timingStatus === 'scheduled' ? 'Orario programmato' : 'Stato non disponibile'}</Text> : null}
    </View> : planned ? <Text className="text-sm leading-5 text-secondary">Orario dal piano MATO · partenze dal vivo non disponibili</Text> : null}
  </View>;
}
