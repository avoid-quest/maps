import { useState } from 'react';
import { View } from 'react-native';
import type { TransitTime } from '../../domain/types';
import { Chip, Notice, SegmentedControl } from '../../ui';
import { Text } from '../../ui/Text';
import { openCivilPicker } from './civil-picker';
import { pickedCivil, pickerValue, romeDayLabel, timeChipLabel, timeDirection, withCivilChange, withDirection, type TimeDirection } from './transit-time-control';

const directions: { value: TimeDirection; label: string }[] = [{ value: 'depart', label: 'Partenza' }, { value: 'arrive', label: 'Arrivo' }];

/**
 * One chip naming the journey time ("Partenza adesso"). It opens Partenza/Arrivo and Android's own
 * date and time dialogs, read in Europe/Rome; each choice plans again at once.
 */
export function TransitTimeControl({ value, onChange, disabled }: { value: TransitTime; onChange: (value: TransitTime) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const now = new Date();
  const label = timeChipLabel(value, now);
  const civil = value.kind === 'now' ? pickedCivil(now) : { date: value.date, time: value.time.slice(0, 5) };
  function apply(next: () => TransitTime) {
    try { onChange(next()); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Controlla data e orario.'); }
  }
  async function pick(mode: 'date' | 'time') {
    const chosen = await openCivilPicker(mode, pickerValue(value, new Date()));
    // Validated as chosen: a nonexistent or ambiguous DST minute shows an error and keeps the current time.
    if (chosen) apply(() => withCivilChange(value, chosen, timeDirection(value), new Date()));
  }
  return (
    <View className="gap-3">
      <View className="flex-row">
        <Chip icon="time-outline" label={label} selected={false} accessibilityLabel={`${label}, ora italiana. ${open ? 'Chiudi' : 'Cambia'} orario`}
          onPress={() => { if (!disabled || open) setOpen(!open); }} />
      </View>
      {open ? (
        <View className="gap-3">
          <SegmentedControl accessibilityLabel="Partenza o arrivo" disabled={disabled} options={directions} value={timeDirection(value)}
            onChange={direction => apply(() => withDirection(value, direction, new Date()))} />
          <View className="flex-row flex-wrap gap-2">
            <Chip label="Adesso" selected={value.kind === 'now'} onPress={() => apply(() => ({ kind: 'now' }))} />
            <Chip icon="calendar-outline" label={romeDayLabel(civil.date, now)} accessibilityLabel={`Data: ${romeDayLabel(civil.date, now)}. Scegli la data`} onPress={() => { void pick('date'); }} />
            <Chip icon="time-outline" label={civil.time} accessibilityLabel={`Ora: ${civil.time}. Scegli l’ora`} onPress={() => { void pick('time'); }} />
          </View>
          <Text className="text-sm leading-5 text-secondary">Ora italiana</Text>
          {error ? <Notice tone="danger" text={error} /> : null}
        </View>
      ) : null}
    </View>
  );
}
