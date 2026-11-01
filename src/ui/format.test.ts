import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, formatDuration } from './format';

test('durations carry rounded minutes into hours', () => {
  assert.equal(formatDuration(20), '1 min', 'Short routes show at least a minute');
  assert.equal(formatDuration(1500), '25 min');
  assert.equal(formatDuration(3599), '1 h 0 min');
  assert.equal(formatDuration(3600), '1 h 0 min');
  assert.equal(formatDuration(5430), '1 h 31 min');
  assert.equal(formatDuration(7199), '2 h 0 min');
});

test('distances use Italian decimals and stay empty when unknown', () => {
  assert.equal(formatDistance(undefined), '');
  assert.equal(formatDistance(999.6), '1000 m');
  assert.equal(formatDistance(1250), '1,3 km');
});
