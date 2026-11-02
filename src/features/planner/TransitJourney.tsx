import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RoutePlan, Stop, TransitTime } from '../../domain/types';
import { matchJourneyStop } from '../../services/transit-stop-matching';
import { useThemeColors } from '../../theme';
import type { ThemeColors } from '../../theme/palette';
import { Button, Icon, IconButton, Notice, Num, Text, TransitLineBadge } from '../../ui';
import { PressableSurface } from '../../ui/PressableSurface';
import { journeyDate, journeyTime, savedJourneyTimeLabel, transitTimeLabel } from './journey-presentation';
import { alternativeRow, journeyTimeline, PLAN_FRESH_MS, type AlternativeRow, type TimelineItem, type TimelineTime, type TimingTone } from './transit-journey';

export const TONE_CLASS: Record<TimingTone, string> = {
  neutral: 'text-primary', scheduled: 'text-scheduled', caution: 'text-caution', disruption: 'text-cancelled font-semibold',
};

/**
 * Transit results: concise alternatives, then the selected journey's timeline at once. Times are
 * Geist Mono; provenance is spelled out on every boarding and alighting.
 */
export function JourneyResults({ plans, selected, onSelect, onRefresh, loading, error, now, query, saved = false, retained = false, destination, onOpenStop }: {
  plans: RoutePlan[]; selected: RoutePlan; onSelect: (id: string) => void; onRefresh: () => void;
  loading: boolean; error: string; now: number; query: TransitTime; saved?: boolean; retained?: boolean;
  destination?: string; onOpenStop?: (stop: Stop) => void;
}) {
  const age = Math.max(0, Math.floor((now - selected.fetchedAt) / 60_000));
  const stale = saved || retained || now - selected.fetchedAt > PLAN_FRESH_MS;
  // A retained selection is no longer among the fresh alternatives: list it first, marked.
  const rows = useMemo(() => (retained && !plans.some(plan => plan.id === selected.id) ? [selected, ...plans] : plans)
    .map((plan, index) => ({ plan, row: alternativeRow(plan, now, index) })), [plans, selected, retained, now]);
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold leading-5 text-primary">{saved ? savedJourneyTimeLabel(query, selected.fetchedAt) : transitTimeLabel(query)}</Text>
          <Text className="text-sm leading-5 text-secondary">
            Consultato il {journeyDate(selected.fetchedAt)} alle <Num className="text-sm text-secondary">{journeyTime(selected.fetchedAt)}</Num>
            {age === 0 ? ' · meno di 1 min fa' : <> · <Num className="text-sm text-secondary">{age}</Num> min fa</>}{stale ? ' · da aggiornare' : ''}
          </Text>
        </View>
        <IconButton icon="refresh-outline" label={saved && query.kind === 'now' ? 'Ricalcola adesso' : 'Aggiorna percorsi'} busy={loading} disabled={loading} onPress={onRefresh} />
      </View>
      {error ? <Notice tone="danger" text={`${error} Percorso precedente conservato.`} /> : null}
      {retained ? <Notice tone="caution" text="Il percorso scelto non è più tra le alternative aggiornate. Scegline una nuova." /> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="Alternative di viaggio">
        {rows.map(({ plan, row }) => <AlternativeRowView key={plan.id} row={row} selected={plan.id === selected.id} outdated={retained && plan.id === selected.id} onPress={() => onSelect(plan.id)} />)}
      </View>
      <JourneyTimeline plan={selected} now={now} stale={stale} destination={destination} onOpenStop={onOpenStop} />
      {selected.legs.some(leg => leg.timingStatus === 'prediction') ? <Notice text="Previsioni MATO: aggiornamento della fonte non disponibile. Verifica alla fermata." /> : null}
      {selected.warnings.map((warning, index) => <Notice key={index} text={warning} />)}
      <Text className="text-sm leading-5 text-secondary">{selected.source} · © OpenStreetMap contributors. Ora italiana.</Text>
    </View>
  );
}

function AlternativeRowView({ row, selected, outdated, onPress }: { row: AlternativeRow; selected: boolean; outdated: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <PressableSurface
      surfaceStyle={{ borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: selected ? colors.surfaceRaised : 'transparent' }}
      contentClassName="min-h-16 flex-row items-stretch gap-3 py-3 pr-2"
      rippleColor={`${colors.textPrimary}14`}
      accessibilityRole="radio"
      accessibilityLabel={`${row.accessibilityLabel}${outdated ? ', da aggiornare' : ''}`}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
    >
      {/* Selection is a bar plus a check mark, never fill alone. */}
      <View style={{ width: 3, borderRadius: 2, backgroundColor: selected ? colors.action : 'transparent' }} />
      <View className="min-w-0 flex-1 gap-1.5">
        <View className="flex-row items-baseline gap-2">
          <Num className="text-lg font-semibold text-primary">{row.departure} – {row.arrival}</Num>
          {row.arrivalDay ? <Text className="text-sm text-secondary">{row.arrivalDay}</Text> : null}
          <View className="flex-1" />
          <Num className="text-base text-primary">{row.duration}</Num>
        </View>
        <SegmentStrip row={row} />
        <Text className="text-sm leading-5 text-secondary">
          <Num className="text-sm text-secondary">{row.walking}</Num> · {row.changes} · <Text className={`text-sm ${TONE_CLASS[row.confidence.tone]}`}>{outdated ? 'Da aggiornare' : row.confidence.label}</Text>
        </Text>
      </View>
      <View className="w-6 items-center justify-center">{selected ? <Icon name="checkmark-circle" size={21} color={colors.action} /> : null}</View>
    </PressableSurface>
  );
}

function SegmentStrip({ row }: { row: AlternativeRow }) {
  const colors = useThemeColors();
  if (!row.segments.length) return <Text className="text-sm leading-5 text-primary">A piedi fino alla destinazione</Text>;
  return <View importantForAccessibility="no-hide-descendants" className="flex-row flex-wrap items-center gap-1">
    {row.segments.map(segment => segment.kind === 'line'
      ? (segment.line ? <TransitLineBadge key={segment.key} line={segment.line} mode={segment.mode} /> : <Text key={segment.key} className="text-sm text-primary">{segment.label}</Text>)
      : segment.kind === 'stay'
        ? <Text key={segment.key} className="text-sm text-secondary">= </Text>
        : <View key={segment.key} accessible={false} className="flex-row items-center">
          <Icon name="chevron-forward" size={14} color={colors.textSecondary} />
          {segment.walk ? <><Icon name="walk-outline" size={15} color={colors.textSecondary} /><Icon name="chevron-forward" size={14} color={colors.textSecondary} /></> : null}
        </View>)}
  </View>;
}

/** The selected journey as one vertical rail: walks are thin, rides are the solid ink line. */
export function JourneyTimeline({ plan, now, stale, destination, onOpenStop, currentKey }: {
  plan: RoutePlan; now: number; stale: boolean; destination?: string; onOpenStop?: (stop: Stop) => void;
  /** Key of the one step being followed (`walk:`, `board:` or `ride:` plus the leg ID). */
  currentKey?: string;
}) {
  const items = useMemo(() => journeyTimeline(plan, { now, stale, destination, match: matchJourneyStop }), [plan, now, stale, destination]);
  return <View accessibilityLabel="Tappe del viaggio" className="pt-1">
    {items.map((item, index) => <TimelineRow key={item.key} item={item} last={index === items.length - 1} rail={railKind(items[index + 1])} current={item.key === currentKey} onOpenStop={onOpenStop} />)}
  </View>;
}

type Rail = 'ride' | 'walk' | 'none';
function railKind(next: TimelineItem | undefined): Rail {
  if (!next) return 'none';
  return next.kind === 'ride' || next.kind === 'alight' ? 'ride' : 'walk';
}

function railColor(colors: ThemeColors, rail: Rail) { return rail === 'ride' ? colors.textPrimary : rail === 'walk' ? colors.divider : 'transparent'; }

function TimelineRow({ item, last, rail, current, onOpenStop }: { item: TimelineItem; last: boolean; rail: Rail; current: boolean; onOpenStop?: (stop: Stop) => void }) {
  const colors = useThemeColors();
  const node = item.kind === 'board' || item.kind === 'alight' || item.kind === 'arrive';
  const time = item.kind === 'board' || item.kind === 'alight' ? item.at : null;
  return <View className="flex-row gap-2">
    <View style={{ width: 52 }} className="items-end pt-0.5">
      {time ? <TimeCell at={time} /> : item.kind === 'arrive' ? <Num className="text-base font-semibold text-primary">{item.time}</Num> : null}
    </View>
    <View style={{ width: 18 }} className="items-center">
      {node
        ? <View style={{ marginTop: 5, width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: colors.textPrimary, backgroundColor: item.kind === 'arrive' ? colors.textPrimary : colors.surface }} />
        : <View style={{ marginTop: 6, width: 18, alignItems: 'center' }}>{item.kind === 'walk' ? <Icon name="walk-outline" size={15} color={colors.textSecondary} /> : null}</View>}
      {!last ? <View style={{ flex: 1, minHeight: 10, width: item.kind === 'ride' || (item.kind === 'board' && rail === 'ride') ? 3 : 2, backgroundColor: item.kind === 'ride' ? colors.textPrimary : railColor(colors, rail), marginTop: 2 }} /> : null}
    </View>
    <View style={current ? { borderLeftWidth: 2, borderLeftColor: colors.live, paddingLeft: 8 } : undefined} className="min-w-0 flex-1 gap-1 pb-4">
      <TimelineContent item={item} onOpenStop={onOpenStop} />
      {current ? <Text className="text-sm font-semibold text-live">In corso</Text> : null}
    </View>
  </View>;
}

function TimeCell({ at }: { at: TimelineTime }) {
  return <View className="items-end">
    <Num className={`text-base font-semibold ${at.tone === 'disruption' ? 'text-cancelled' : 'text-primary'}`}>{at.time}</Num>
    {at.scheduled ? <Num accessibilityLabel={`programmato ${at.scheduled}`} style={{ textDecorationLine: 'line-through' }} className="text-sm text-secondary">{at.scheduled}</Num> : null}
  </View>;
}

function StopLine({ stop }: { stop: { name: string; code?: string; platform?: string } }) {
  return <Text className="text-base font-medium leading-6 text-primary">{stop.name}
    {stop.code ? <Text className="text-sm font-normal text-secondary"> · fermata <Num className="text-sm text-secondary">{stop.code}</Num></Text> : null}
    {stop.platform ? <Text className="text-sm font-normal text-secondary"> · banchina <Num className="text-sm text-secondary">{stop.platform}</Num></Text> : null}
  </Text>;
}

function TimelineContent({ item, onOpenStop }: { item: TimelineItem; onOpenStop?: (stop: Stop) => void }) {
  switch (item.kind) {
    case 'walk': return <>
      <Text className="text-base leading-6 text-primary">{item.title}</Text>
      <Num className="text-sm text-secondary">{item.detail}</Num>
    </>;
    case 'wait': return <Num className="text-sm text-secondary">{item.title}</Num>;
    case 'board': return <>
      <View className="flex-row flex-wrap items-center gap-2">
        {item.line ? <TransitLineBadge line={item.line} mode={item.mode} /> : <Text className="text-base font-semibold text-primary">{item.lineLabel}</Text>}
        <Text className="min-w-0 shrink text-sm leading-5 text-primary">{item.direction}</Text>
      </View>
      <Text className={`text-sm font-semibold ${item.cancelled ? 'text-cancelled' : 'text-secondary'}`}>{item.title}</Text>
      <StopLine stop={item.stop} />
      <ProvenanceLine at={item.at} />
      {item.stop.board && onOpenStop ? <StopBoardButton stop={item.stop.board} onOpen={onOpenStop} /> : null}
    </>;
    case 'ride': return <RideStops item={item} />;
    case 'alight': return <>
      <Text className="text-sm font-semibold text-secondary">{item.title}</Text>
      <StopLine stop={item.stop} />
      <ProvenanceLine at={item.at} />
      {item.stop.board && onOpenStop ? <StopBoardButton stop={item.stop.board} onOpen={onOpenStop} /> : null}
    </>;
    case 'arrive': return <Text className="text-base font-semibold leading-6 text-primary">Arrivo · {item.name}</Text>;
  }
}

function ProvenanceLine({ at }: { at: TimelineTime }) {
  return <Text className={`text-sm leading-5 ${TONE_CLASS[at.tone]}`}>{at.provenance}{at.scheduled ? <> · programmato <Num className={`text-sm ${TONE_CLASS[at.tone]}`}>{at.scheduled}</Num></> : null}</Text>;
}

function RideStops({ item }: { item: Extract<TimelineItem, { kind: 'ride' }> }) {
  const [open, setOpen] = useState(false);
  const stops = item.stops ?? [];
  const collapsible = stops.length > 3;
  const visible = !collapsible || open;
  return <View className="gap-1">
    <Text className="text-sm text-secondary"><Num className="text-sm text-secondary">{item.duration}</Num> · {item.summary}</Text>
    {visible && stops.length ? <View className="gap-0.5">
      {stops.map((stop, index) => <Text key={`${stop.id}:${index}`} className="text-sm leading-5 text-secondary">
        {stop.arrivalAt ? <Num className="text-sm text-secondary">{journeyTime(stop.arrivalAt)}  </Num> : null}{stop.name}{stop.code ? <Text className="text-sm text-secondary"> · <Num className="text-sm text-secondary">{stop.code}</Num></Text> : null}
      </Text>)}
    </View> : null}
    {collapsible ? <View className="self-start"><Button variant="quiet" icon={open ? 'chevron-up' : 'chevron-down'} onPress={() => setOpen(value => !value)}>{open ? 'Nascondi fermate' : 'Mostra fermate'}</Button></View> : null}
  </View>;
}

function StopBoardButton({ stop, onOpen }: { stop: Stop; onOpen: (stop: Stop) => void }) {
  return <View className="self-start">
    <Button variant="secondary" icon="time-outline" accessibilityLabel={`Partenze della fermata ${stop.code}, ${stop.name}`} onPress={() => onOpen(stop)}>{`Partenze · ${stop.code}`}</Button>
  </View>;
}

