import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { pickedCivil, type CivilChoice } from './transit-time-control';

/**
 * Android's own date or time dialog, shown and read in Europe/Rome whatever the device zone.
 * Resolves the chosen Rome civil date or minute, or null when dismissed.
 */
export function openCivilPicker(mode: 'date' | 'time', value: Date): Promise<CivilChoice | null> {
  return new Promise(resolve => {
    DateTimePickerAndroid.open({
      value, mode, is24Hour: true, timeZoneName: 'Europe/Rome',
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) { resolve(null); return; }
        const civil = pickedCivil(date);
        resolve(mode === 'date' ? { date: civil.date } : { time: civil.time });
      },
    });
  });
}
