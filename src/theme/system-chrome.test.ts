import test from 'node:test';
import assert from 'node:assert/strict';
import { palettes } from './palette';
import { systemChromeFor } from './system-chrome';

test('dark appearance uses light system icons and a dark navigation bar style', () => {
  assert.deepEqual(systemChromeFor('dark', 'dark'), { appearanceOverride: 'dark', statusBarStyle: 'light', navigationBarStyle: 'dark', rootBackground: palettes.dark.colors.surface });
  assert.deepEqual(systemChromeFor('light', 'light'), { appearanceOverride: 'light', statusBarStyle: 'dark', navigationBarStyle: 'light', rootBackground: palettes.light.colors.surface });
});

test('following the system clears the native appearance override', () => {
  assert.equal(systemChromeFor('system', 'dark').appearanceOverride, null);
  assert.equal(systemChromeFor('system', 'dark').statusBarStyle, 'light');
  assert.equal(systemChromeFor('system', 'light').appearanceOverride, null);
});
