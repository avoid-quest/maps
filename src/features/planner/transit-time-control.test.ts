import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCivil, pickedCivil, pickerValue, romeDayLabel, romeInstant, timeChipLabel, withCivilChange, withDirection } from './transit-time-control';

const evening = new Date('2026-10-11T21:58:00Z'); // 23:58 in Rome

test('the chip names the choice in Rome time: adesso, today, tomorrow or a date', () => {
  assert.equal(timeChipLabel({ kind: 'now' }, evening), 'Partenza adesso');
  assert.equal(timeChipLabel({ kind: 'depart-at', date: '2026-10-11', time: '23:59' }, evening), 'Partenza 23:59');
  assert.equal(timeChipLabel({ kind: 'depart-at', date: '2026-10-12', time: '07:05' }, evening), 'Partenza 07:05 · domani');
  assert.equal(timeChipLabel({ kind: 'arrive-by', date: '2026-10-15', time: '09:00' }, evening), 'Arrivo entro 09:00 · gio 15 ott');
  // After Rome midnight (still the 11th in UTC), "oggi" is already the 12th.
  assert.equal(romeDayLabel('2026-10-12', new Date('2026-10-11T22:30:00Z')), 'oggi');
});

test('Partenza/Arrivo keeps the chosen minute; from adesso it starts at the current Rome minute', () => {
  assert.deepEqual(withDirection({ kind: 'now' }, 'arrive', evening), { kind: 'arrive-by', date: '2026-10-11', time: '23:58' });
  assert.deepEqual(withDirection({ kind: 'now' }, 'depart', evening), { kind: 'depart-at', date: '2026-10-11', time: '23:58' });
  const chosen = { kind: 'depart-at', date: '2026-10-14', time: '17:45' } as const;
  assert.deepEqual(withDirection(chosen, 'arrive', evening), { kind: 'arrive-by', date: '2026-10-14', time: '17:45' });
  assert.equal(withDirection(chosen, 'depart', evening), chosen);
});

test('picked dates and times change one part; nonexistent and ambiguous DST minutes are refused', () => {
  const chosen = { kind: 'arrive-by', date: '2026-10-14', time: '17:45' } as const;
  assert.deepEqual(withCivilChange(chosen, { time: '08:15' }), { kind: 'arrive-by', date: '2026-10-14', time: '08:15' });
  assert.deepEqual(withCivilChange(chosen, { date: '2026-10-20' }), { kind: 'arrive-by', date: '2026-10-20', time: '17:45' });
  assert.deepEqual(withCivilChange({ kind: 'now' }, { time: '06:30' }, 'depart', evening), { kind: 'depart-at', date: '2026-10-11', time: '06:30' });
  assert.throws(() => withCivilChange(chosen, { date: '2026-10-25', time: '02:30' }), /ambiguo/);
  assert.throws(() => withCivilChange(chosen, { date: '2026-03-29', time: '02:30' }), /inesistente/);
});

test('native pickers open and read in Europe/Rome independent of the device zone', () => {
  assert.equal(romeInstant('2026-10-14', '17:45').toISOString(), '2026-10-14T15:45:00.000Z');
  assert.equal(romeInstant('2026-01-14', '17:45').toISOString(), '2026-01-14T16:45:00.000Z');
  assert.deepEqual(pickedCivil(new Date('2026-10-11T22:07:00Z')), { date: '2026-10-12', time: '00:07' });
  assert.equal(pickerValue({ kind: 'now' }, evening), evening);
  assert.deepEqual(pickedCivil(pickerValue({ kind: 'depart-at', date: '2026-03-29', time: '03:30' })), { date: '2026-03-29', time: '03:30' });
});

test('a browser-picked spring-forward minute is validated as chosen, not shifted to a valid instant', () => {
  const chosen = { kind: 'depart-at', date: '2027-03-28', time: '01:30' } as const;
  const picked = browserCivil('time', '02:30');
  assert.deepEqual(picked, { time: '02:30' });
  assert.throws(() => withCivilChange(chosen, picked!), /inesistente/);
  assert.deepEqual(browserCivil('date', '2027-03-28'), { date: '2027-03-28' });
  assert.equal(browserCivil('time', ''), null);
  assert.equal(browserCivil('date', '28/03/2027'), null);
});
