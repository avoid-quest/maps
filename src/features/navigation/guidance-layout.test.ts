import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerMetrics, MAX_FONT_SCALE, stripLayout } from './guidance-layout';

test('banner reserves cover the tallest text state at every font scale up to the cap', () => {
  for (const scale of [1, 1.15, 1.3, 1.5, 1.8, 2, 2.5]) {
    const effective = Math.min(scale, MAX_FONT_SCALE);
    const metrics = bannerMetrics(scale);
    assert.ok(metrics.lines >= (2 * 28) * effective, 'two street lines');
    assert.ok(metrics.lines >= (28 + 24) * effective, 'one street line plus the action');
    assert.ok(metrics.firstRow >= 42 * 1.15 * effective, 'the distance line');
    assert.ok(metrics.thenRow >= 22, 'the Poi glyph fits');
  }
  assert.deepEqual(bannerMetrics(2.5), bannerMetrics(2), 'text is capped, so are the reserves');
});

test('the strip stacks on narrow screens and with large text', () => {
  assert.equal(stripLayout(412, 1), 'row');
  assert.equal(stripLayout(360, 1), 'stacked');
  assert.equal(stripLayout(412, 1.3), 'stacked');
  assert.equal(stripLayout(915, 1.3), 'row');
});
