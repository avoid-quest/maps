import test from 'node:test';
import assert from 'node:assert/strict';
import { AA_TEXT, contrastRatio } from '../theme/contrast';
import { palettes } from '../theme/palette';
import { lineAccessibilityLabel, lineBadgeColors, transitModeFromLeg, transitModeFromLineName } from './transit-line';

const fallback = { background: palettes.light.colors.textPrimary, text: palettes.light.colors.surface };

test('route colours keep a supplied text colour only when it reaches AA', () => {
  assert.deepEqual(lineBadgeColors('E2001A', 'FFFFFF', fallback), { background: '#E2001A', text: '#FFFFFF', source: 'route' });
  const yellow = lineBadgeColors('#FFD500', 'FFFFFF', fallback);
  assert.equal(yellow.text, '#000000', 'white on yellow fails AA, so black replaces it');
  for (const color of ['FFD500', '00A651', '0072BC', 'E2001A', '808080', '777777', '000000', 'FFFFFF']) {
    const result = lineBadgeColors(color, undefined, fallback);
    assert.ok(contrastRatio(result.text, result.background) >= AA_TEXT, `${color}: ${contrastRatio(result.text, result.background)}`);
  }
});

test('missing or malformed route colours fall back to the AA theme pair', () => {
  for (const color of [undefined, null, '', 'red', '#12345', 'GGGGGG']) {
    assert.deepEqual(lineBadgeColors(color, 'FFFFFF', fallback), { ...fallback, source: 'fallback' });
  }
  for (const palette of Object.values(palettes)) {
    assert.ok(contrastRatio(palette.colors.surface, palette.colors.textPrimary) >= AA_TEXT);
  }
});

test('modes come from leg data; line names classify only the GTT metro', () => {
  assert.equal(transitModeFromLeg('SUBWAY'), 'metro');
  assert.equal(transitModeFromLeg('tram'), 'tram');
  assert.equal(transitModeFromLeg('bus'), 'bus');
  assert.equal(transitModeFromLeg('RAIL'), 'rail');
  assert.equal(transitModeFromLeg('walk'), undefined);
  assert.equal(transitModeFromLineName('M1'), 'metro');
  assert.equal(transitModeFromLineName('M1S'), undefined, 'substitute services are not assumed to be metro');
  assert.equal(transitModeFromLineName('4'), undefined, 'numeric names are shared by trams and buses');
  assert.equal(lineAccessibilityLabel('4', 'tram'), 'Tram 4');
  assert.equal(lineAccessibilityLabel('M1', 'metro'), 'Metro linea 1');
  assert.equal(lineAccessibilityLabel('58/', undefined), 'Linea 58/');
});
