import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

/**
 * Android's own date or time dialog, shown and read in Europe/Rome whatever the device zone.
 * Resolves the picked instant, or null when dismissed.
 */
export function openCivilPicker(mode: 'date' | 'time', value: Date): Promise<Date | null> {
  return new Promise(resolve => {
    DateTimePickerAndroid.open({
      value, mode, is24Hour: true, timeZoneName: 'Europe/Rome',
      onChange: (event, date) => resolve(event.type === 'set' && date ? date : null),
    });
  });
}
