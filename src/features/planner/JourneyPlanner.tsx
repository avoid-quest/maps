import { useReducer, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import type { RouteLeg, RoutePlan, RouteStop, Stop, TransitTime } from '../../domain/types';
import { useThemeColors } from '../../theme';
import { Button, Chip, Disclosure, Icon, Notice, SegmentedControl, TransitLineBadge, transitModeFromLeg } from '../../ui';
import { matchJourneyStop } from '../../services/transit-stop-matching';
import {
  createTransitTimeDraft, draftTransitTime, italianDate, journeyDate, journeyDistance, journeyDuration,
  journeyTime, journeyTimingLabel, nextRomeDate, savedJourneyTimeLabel, transitTimeDraftReducer, transitTimeLabel, waitBefore,
} from './journey-presentation';

const timeModes: { kind: TransitTime['kind']; label: string }[] = [
  { kind: 'now', label: 'Adesso' }, { kind: 'depart-at', label: 'Parti alle' }, { kind: 'arrive-by', label: 'Arriva entro' },
];

export function TransitTimeForm({ value, onSubmit, disabled }: {
  value: TransitTime; onSubmit: (value: TransitTime) => void; disabled: boolean;
}) {
  const [{ kind, date, time }, updateDraft] = useReducer(transitTimeDraftReducer, value, createTransitTimeDraft);
  const [error, setError] = useState('');
  const colors = useThemeColors();
  function submit() {
    try {
      const next = draftTransitTime(kind, date.trim(), time.trim());
      updateDraft({ type: 'submitted', value: next, now: new Date() });
      setError('');
      Keyboard.dismiss();
      onSubmit(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Controlla data e orario.');
    }
  }
  return (
    <View className="gap-3">
      <SegmentedControl accessibilityLabel="Orario del viaggio" options={timeModes.map(item => ({ value: item.kind, label: item.label }))} value={kind}
        onChange={next => { updateDraft({ type: 'kind', kind: next, now: new Date() }); setError(''); }} />
      {kind !== 'now' ? (
        <>
          <View className="flex-row gap-2">
            {[{ label: 'Oggi', days: 0 }, { label: 'Domani', days: 1 }].map(item => (
              <Chip key={item.label} label={item.label} selected={date === italianDate(nextRomeDate(item.days))}
                onPress={() => { updateDraft({ type: 'date', value: italianDate(nextRomeDate(item.days)) }); setError(''); }} />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-36 flex-1 gap-1">
              <Text className="text-sm text-secondary">Data (gg/mm/aaaa)</Text>
              <TextInput
                accessibilityLabel="Data del viaggio, giorno mese anno"
                value={date}
                onChangeText={text => { updateDraft({ type: 'date', value: text }); setError(''); }}
                placeholder="gg/mm/aaaa"
                autoCorrect={false}
                inputMode="text"
                maxLength={10}
                placeholderTextColor={colors.textSecondary}
                className="min-h-12 min-w-0 rounded-xl border border-divider bg-surface-raised px-3 py-2 text-base text-primary"
              />
            </View>
            <View className="min-w-24 flex-1 gap-1">
              <Text className="text-sm text-secondary">Ora (HH:mm)</Text>
              <TextInput
                accessibilityLabel="Ora del viaggio, ore e minuti"
                value={time}
                onChangeText={text => { updateDraft({ type: 'time', value: text }); setError(''); }}
                placeholder="HH:mm"
                autoCorrect={false}
                inputMode="text"
                maxLength={5}
                returnKeyType="search"
                onSubmitEditing={disabled ? undefined : submit}
                placeholderTextColor={colors.textSecondary}
                className="min-h-12 min-w-0 rounded-xl border border-divider bg-surface-raised px-3 py-2 text-base text-primary"
              />
            </View>
          </View>
        </>
      ) : null}
      <Text className="text-sm leading-5 text-secondary">Ora italiana</Text>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button onPress={submit} disabled={disabled}>Cerca percorsi</Button>
    </View>
  );
}

function stopLabel(stop: RouteStop | undefined, fallback: string) {
  return `${stop?.name ?? fallback}${stop?.code ? ` · fermata ${stop.code}` : ''}${stop?.platformCode ? ` · banchina ${stop.platformCode}` : ''}`;
}
function legLabel(leg: RouteLeg) {
  return leg.transitLeg ? (leg.line ? `Linea ${leg.line}` : 'Mezzo pubblico') : leg.mode === 'walk' ? 'A piedi' : leg.mode === 'bicycle' ? 'In bici' : leg.mode === 'car' ? 'In auto' : 'Tratta';
}
/** The plan's transit lines as badges in boarding order; walking-only plans say so in words. */
function LegBadges({ plan }: { plan: RoutePlan }) {
  const legs = plan.legs.filter(leg => leg.transitLeg);
  if (!legs.length) return <Text className="text-sm leading-5 text-primary">A piedi fino alla destinazione</Text>;
  return <View accessible accessibilityLabel={legs.map(legLabel).join(', poi ')} className="flex-row flex-wrap items-center gap-1.5">
    {legs.map((leg, index) => <View key={leg.id} className="flex-row items-center gap-1.5">
      {index ? <Text className="text-sm text-secondary">›</Text> : null}
      {leg.line ? <TransitLineBadge line={leg.line} mode={transitModeFromLeg(leg.mode)} /> : <Text className="text-sm text-primary">{legLabel(leg)}</Text>}
    </View>)}
  </View>;
}
function transferLabel(plan: RoutePlan) {
  if (!plan.legs.some(leg => leg.transitLeg)) return plan.legs.every(leg => leg.mode === 'walk') ? 'Solo a piedi' : 'Senza mezzi pubblici';
  return plan.transferCount === 0 ? 'Nessun cambio' : `${plan.transferCount} ${plan.transferCount === 1 ? 'cambio' : 'cambi'}`;
}
function timeRange(plan: RoutePlan) {
  const overnight = plan.departureAt != null && plan.arrivalAt != null && journeyDate(plan.departureAt) !== journeyDate(plan.arrivalAt);
  return `${journeyTime(plan.departureAt)} – ${journeyTime(plan.arrivalAt)}${overnight ? ` del ${journeyDate(plan.arrivalAt!)}` : ''}`;
}

export function JourneyResults({ plans, selected, onSelect, onRefresh, loading, error, now, query, saved = false, retained = false, onOpenStop }: {
  plans: RoutePlan[]; selected: RoutePlan; onSelect: (id: string) => void; onRefresh: () => void;
  loading: boolean; error: string; now: number; query: TransitTime; saved?: boolean; retained?: boolean; onOpenStop?: (stop: Stop) => void;
}) {
  const age = Math.max(0, Math.floor((now - selected.fetchedAt) / 60_000));
  const stale = saved || retained || now - selected.fetchedAt > 120_000;
  return (
    <View className="gap-4">
      <Text className="text-sm font-semibold leading-5 text-primary">{saved ? savedJourneyTimeLabel(query, selected.fetchedAt) : transitTimeLabel(query)}</Text>
      {error ? <Notice tone="danger" text={`${error} Percorso precedente conservato.`} /> : null}
      {retained ? <Notice text="Percorso precedente da aggiornare. Scegli un’alternativa aggiornata." /> : null}
      <View className="gap-2">
        <Text className="text-sm leading-5 text-secondary">
          Consultato il {journeyDate(selected.fetchedAt)} alle {journeyTime(selected.fetchedAt)}
          {age === 0 ? ' (meno di 1 min fa).' : ` (${age} min fa).`}{stale ? ' Da aggiornare.' : ''}
        </Text>
        <Button variant="secondary" icon={saved && query.kind === 'now' ? undefined : 'refresh-outline'} loading={loading} onPress={onRefresh}>
          {loading ? 'Aggiornamento…' : saved && query.kind === 'now' ? 'Ricalcola adesso' : 'Aggiorna'}
        </Button>
      </View>
      <View className="gap-2">
        {plans.map((plan, index) => (
          <Pressable
            key={plan.id}
            accessibilityRole="button"
            accessibilityLabel={`Percorso ${index + 1}, ${timeRange(plan)}, ${journeyDuration(plan.durationSeconds)}, ${transferLabel(plan)}${plan.id === selected.id ? ', selezionato' : ''}${plan.legs.some(leg => leg.timingStatus === 'cancelled') ? ', include una corsa cancellata' : ''}`}
            accessibilityState={{ selected: plan.id === selected.id }}
            onPress={() => onSelect(plan.id)}
            className={`gap-2 rounded-xl border px-4 py-3 ${plan.id === selected.id ? 'border-action bg-action-subtle' : 'border-divider bg-surface-raised'}`}
          >
            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1 gap-1">
                {plan.departureAt != null ? <Text className="text-sm text-secondary">{journeyDate(plan.departureAt)}</Text> : null}
                <Text className="text-lg font-bold text-primary">{timeRange(plan)}</Text>
                <Text className="text-sm text-secondary">{journeyDuration(plan.durationSeconds)} · {transferLabel(plan)}</Text>
              </View>
              {plan.id === selected.id ? <SelectedMark /> : null}
            </View>
            <LegBadges plan={plan} />
            {plan.legs.some(leg => leg.timingStatus === 'cancelled') ? <Text className="text-sm font-semibold text-cancelled">Include una corsa cancellata</Text> : null}
          </Pressable>
        ))}
      </View>
      <Disclosure title={retained ? 'Tratte del percorso precedente' : 'Tratte'}>
        <Text className="text-sm leading-5 text-secondary">A piedi {journeyDuration(selected.walkingDurationSeconds)} ({journeyDistance(selected.walkingDistanceMeters)}) · Attese {selected.waitingDurationSeconds ? journeyDuration(selected.waitingDurationSeconds) : 'nessuna'} · Ora italiana</Text>
      {selected.legs.map((leg, index) => {
        const previous = selected.legs[index - 1];
        const next = selected.legs[index + 1];
        const wait = waitBefore(leg, previous);
        const boardingStop = leg.transitLeg ? matchJourneyStop(leg.fromStop) : null;
        const alightingStop = leg.transitLeg ? matchJourneyStop(leg.toStop) : null;
        const overnight = leg.departureAt != null && leg.arrivalAt != null && journeyDate(leg.departureAt) !== journeyDate(leg.arrivalAt);
        return (
          <View key={leg.id} className="gap-3">
            {wait > 0 ? <Text className="border-l-2 border-divider pl-3 text-sm leading-5 text-secondary">{leg.interlineWithPreviousLeg ? 'Sosta a bordo' : 'Attesa'}: {journeyDuration(wait)} a {previous?.toStop?.name ?? previous?.to ?? leg.from}</Text> : null}
            <View className={`gap-3 border-l-2 pl-3 ${leg.transitLeg ? 'border-action' : 'border-divider'}`}>
              <View className="gap-1">
                {leg.transitLeg && leg.line ? <TransitLineBadge line={leg.line} mode={transitModeFromLeg(leg.mode)} /> : <Text className="text-base font-bold text-primary">{legLabel(leg)}</Text>}
                {leg.transitLeg ? <Text className="text-sm leading-5 text-primary">{leg.headsign ? `Direzione ${leg.headsign}` : 'Direzione non fornita dal servizio'}</Text> : <Text className="text-sm text-secondary">{journeyDuration(leg.durationSeconds)} · {journeyDistance(leg.distanceMeters)}</Text>}
              </View>
              <View className="gap-1">
                <Text className="text-sm font-semibold text-action">{journeyTime(leg.departureAt)} · {leg.transitLeg ? leg.timingStatus === 'cancelled' ? 'Partenza cancellata da' : leg.interlineWithPreviousLeg ? 'Rimani a bordo' : 'Sali a' : 'Parti da'}</Text>
                <Text className="text-base leading-6 text-primary">{stopLabel(leg.fromStop, leg.from)}</Text>
                {boardingStop && onOpenStop ? <StopArrivalButton stop={boardingStop} onOpen={onOpenStop} /> : null}
              </View>
              <View className="gap-1">
                <Text className="text-sm font-semibold text-action">{journeyTime(leg.arrivalAt)}{overnight ? ` del ${journeyDate(leg.arrivalAt!)}` : ''} · {leg.transitLeg ? leg.timingStatus === 'cancelled' ? 'Arrivo programmato a' : next?.interlineWithPreviousLeg ? 'Prosegui a bordo da' : 'Scendi a' : 'Arrivi a'}</Text>
                <Text className="text-base leading-6 text-primary">{stopLabel(leg.toStop, leg.to)}</Text>
                {alightingStop && onOpenStop ? <StopArrivalButton stop={alightingStop} onOpen={onOpenStop} /> : null}
              </View>
              {leg.transitLeg ? <Text className={`text-sm leading-5 ${leg.timingStatus === 'cancelled' ? 'font-semibold text-cancelled' : 'text-secondary'}`}>{journeyTimingLabel(leg, selected.fetchedAt, now, saved || retained)} · {journeyDuration(leg.durationSeconds)}</Text> : null}
            </View>
          </View>
        );
      })}
      </Disclosure>
      {selected.legs.some(leg => leg.timingStatus === 'prediction') ? <Notice text="Previsioni MATO: aggiornamento della fonte non disponibile." /> : null}
      {selected.warnings.map((warning, index) => <Notice key={index} text={warning} />)}
      <Text className="text-sm leading-5 text-secondary">{selected.source} · © OpenStreetMap contributors. Corse non monitorate durante la guida.</Text>
    </View>
  );
}

function SelectedMark() {
  const colors = useThemeColors();
  return <Icon name="checkmark-circle" color={colors.action} size={21} />;
}

function StopArrivalButton({ stop, onOpen }: { stop: Stop; onOpen: (stop: Stop) => void }) {
  const colors = useThemeColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Arrivi alla fermata ${stop.code}, ${stop.name}`}
    onPress={() => onOpen(stop)} className="min-h-12 flex-row items-center gap-2 self-start rounded-xl bg-action-subtle px-3 py-2">
    <Icon name="bus-outline" size={18} color={colors.action} />
    <Text className="shrink font-semibold text-action">Arrivi alla fermata {stop.code}</Text>
  </Pressable>;
}
