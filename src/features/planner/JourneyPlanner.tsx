import { useReducer, useState } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { Text } from '../../ui/Text';
import type { TransitTime } from '../../domain/types';
import { useThemeColors } from '../../theme';
import { Button, Chip, Notice, SegmentedControl } from '../../ui';
import { createTransitTimeDraft, draftTransitTime, italianDate, nextRomeDate, transitTimeDraftReducer } from './journey-presentation';

const timeModes: { kind: TransitTime['kind']; label: string }[] = [
  { kind: 'now', label: 'Adesso' }, { kind: 'depart-at', label: 'Parti alle' }, { kind: 'arrive-by', label: 'Arriva entro' },
];

export function TransitTimeForm({ value, onSubmit, disabled }: {
  value: TransitTime; onSubmit: (value: TransitTime) => void; disabled: boolean;
}) {
  const [{ kind, date, time }, updateDraft] = useReducer(transitTimeDraftReducer, value, createTransitTimeDraft);
  const [error, setError] = useState('');
  const colors = useThemeColors();
  // Editable fields need a 3:1 boundary (WCAG 1.4.11); the decorative hairline is about 1.2:1.
  const inputBorder = { borderWidth: 1, borderColor: colors.textSecondary };
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
                style={inputBorder}
                className="min-h-12 min-w-0 rounded-xl px-3 py-2 font-mono text-base text-primary"
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
                style={inputBorder}
                className="min-h-12 min-w-0 rounded-xl px-3 py-2 font-mono text-base text-primary"
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
