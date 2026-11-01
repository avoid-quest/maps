import test from 'node:test';
import assert from 'node:assert/strict';
import { numericRuns } from './numeric-runs';

test('digits stay monospaced while separators and units are set apart', () => {
  assert.deepEqual(numericRuns('64 m'), [{ text: '64', numeric: true }, { text: ' m', numeric: false }]);
  assert.deepEqual(numericRuns('23:33'), [{ text: '23', numeric: true }, { text: ':', numeric: false }, { text: '33', numeric: true }]);
  assert.deepEqual(numericRuns('1,2 km').map(run => run.text), ['1,2', ' km'], 'a decimal comma belongs to the number');
  assert.deepEqual(numericRuns('17 min · 4,8 km').filter(run => run.numeric).map(run => run.text), ['17', '4,8']);
  assert.deepEqual(numericRuns('M1'), [{ text: 'M', numeric: false }, { text: '1', numeric: true }]);
  assert.equal(numericRuns('').length, 0);
});
