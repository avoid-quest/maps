import test from 'node:test';
import assert from 'node:assert/strict';
import { numberParts, numericRuns } from './numeric-runs';

test('digits stay monospaced while separators and units are set apart', () => {
  assert.deepEqual(numericRuns('64 m'), [{ text: '64', numeric: true }, { text: ' m', numeric: false }]);
  assert.deepEqual(numericRuns('23:33'), [{ text: '23', numeric: true }, { text: ':', numeric: false }, { text: '33', numeric: true }]);
  assert.deepEqual(numericRuns('1,2 km').map(run => run.text), ['1,2', ' km'], 'a decimal comma belongs to the number');
  assert.deepEqual(numericRuns('17 min · 4,8 km').filter(run => run.numeric).map(run => run.text), ['17', '4,8']);
  assert.deepEqual(numericRuns('M1'), [{ text: 'M', numeric: false }, { text: '1', numeric: true }]);
  assert.equal(numericRuns('').length, 0);
});

test('decimal and thousands separators stay inside the number run; units, spaces and time colons do not', () => {
  assert.deepEqual(numericRuns('4,2 km'), [{ text: '4,2', numeric: true }, { text: ' km', numeric: false }]);
  assert.deepEqual(numericRuns('1.250 m'), [{ text: '1.250', numeric: true }, { text: ' m', numeric: false }]);
  assert.deepEqual(numericRuns('23:51'), [{ text: '23', numeric: true }, { text: ':', numeric: false }, { text: '51', numeric: true }]);
  assert.deepEqual(numericRuns('64 m'), [{ text: '64', numeric: true }, { text: ' m', numeric: false }]);
  // Inside the run, only the separator glyph leaves the monospaced cell (no gap around the comma).
  assert.deepEqual(numberParts('4,2'), [{ text: '4', separator: false }, { text: ',', separator: true }, { text: '2', separator: false }]);
  assert.deepEqual(numberParts('1.250'), [{ text: '1', separator: false }, { text: '.', separator: true }, { text: '250', separator: false }]);
  assert.deepEqual(numberParts('64'), [{ text: '64', separator: false }]);
  assert.equal(numberParts('12.345,6').map(part => part.text).join(''), '12.345,6');
});
