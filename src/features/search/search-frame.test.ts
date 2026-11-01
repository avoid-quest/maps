import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSearchFrame, searchFrameReducer, type SearchFrameAction } from './search-frame';

const run = (...actions: SearchFrameAction[]) => actions.reduce(searchFrameReducer, initialSearchFrame);

test('a submitted search frames only after its own request settles', () => {
  const requested = run({ type: 'request' });
  assert.deepEqual(requested.pending, { revision: 1, settled: false }, 'local results present at submit time are not yet a frame');
  assert.equal(searchFrameReducer(requested, { type: 'settled', revision: 0 }), requested, 'an earlier run cannot settle it');
  assert.deepEqual(searchFrameReducer(requested, { type: 'settled', revision: 1 }).pending, { revision: 1, settled: true });
});

test('editing, clearing or closing withdraws the frame; a later submit gets a new revision', () => {
  const cancelled = run({ type: 'request' }, { type: 'settled', revision: 1 }, { type: 'cancel' });
  assert.equal(cancelled.pending, null, 'typing after reopening search never moves the map');
  const again = searchFrameReducer(cancelled, { type: 'request' });
  assert.equal(again.pending?.revision, 2, 'a consumed revision is never replayed');
  assert.equal(searchFrameReducer(again, { type: 'settled', revision: 1 }).pending?.settled, false);
});
