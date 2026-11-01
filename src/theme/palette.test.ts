import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AA_NON_TEXT, AA_TEXT, contrastRatio, parseHex, rgbChannels } from './contrast';
import { themeVariables } from './css-variables';
import { kebabTokenName, palettes, themeColorNames, type ThemeColors } from './palette';
import { colors as legacyColors } from './tokens';

const surfaces = ['surface', 'surfaceRaised', 'surfaceMuted'] as const;
const textRoles = ['textPrimary', 'textSecondary', 'action', 'caution', 'danger', 'success', 'live', 'scheduled', 'stale', 'cancelled'] as const;
const pairs: [foreground: keyof ThemeColors, background: keyof ThemeColors][] = [
  ['onAction', 'action'],
  ['action', 'actionSubtle'], ['textPrimary', 'actionSubtle'], ['textSecondary', 'actionSubtle'],
  ['caution', 'cautionSubtle'], ['textPrimary', 'cautionSubtle'],
  ['danger', 'dangerSubtle'], ['textPrimary', 'dangerSubtle'],
  ['success', 'successSubtle'], ['textPrimary', 'successSubtle'],
];

test('contrast arithmetic matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrastRatio('#777', '#FFF').toFixed(2), '4.48');
  assert.deepEqual(parseHex('#1d5BD6'), [29, 91, 214]);
  assert.equal(rgbChannels('#FFF'), '255 255 255');
  assert.throws(() => parseHex('rgb(0,0,0)'));
});

for (const palette of Object.values(palettes)) {
  test(`${palette.scheme}: every text role meets WCAG AA on every surface and paired fill`, () => {
    const results: string[] = [];
    for (const role of textRoles) for (const surface of surfaces) {
      const ratio = contrastRatio(palette.colors[role], palette.colors[surface]);
      results.push(`${role}/${surface} ${ratio.toFixed(2)}`);
      assert.ok(ratio >= AA_TEXT, `${palette.scheme} ${role} on ${surface}: ${ratio.toFixed(2)}`);
    }
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(palette.colors[foreground], palette.colors[background]);
      assert.ok(ratio >= AA_TEXT, `${palette.scheme} ${foreground} on ${background}: ${ratio.toFixed(2)}`);
    }
  });

  test(`${palette.scheme}: map overlays stand out from the basemap and their strokes`, () => {
    const { map } = palette;
    for (const key of ['routeLine', 'placeMarker', 'stopMarker', 'userLocation', 'live', 'caution', 'coverage'] as const) {
      assert.ok(contrastRatio(map[key], map.background) >= AA_NON_TEXT, `${key} on basemap`);
    }
    assert.ok(contrastRatio(map.routeLine, map.routeCasing) >= AA_NON_TEXT, 'route line on casing');
    for (const key of ['placeMarker', 'stopMarker', 'live', 'caution'] as const) {
      assert.ok(contrastRatio(map[key], map.markerStroke) >= AA_NON_TEXT, `${key} on stroke`);
    }
    assert.ok(contrastRatio(map.selectedMarkerStroke, map.background) >= AA_NON_TEXT, 'selection ring on basemap');
    assert.ok(contrastRatio(map.selectedMarkerStroke, map.markerStroke) >= AA_NON_TEXT, 'selection ring differs from the normal stroke');
    assert.ok(contrastRatio(map.userLocation, map.userLocationStroke) >= AA_NON_TEXT, 'location dot on stroke');
    assert.ok(contrastRatio(map.labelText, map.labelHalo) >= AA_TEXT, 'label on halo');
  });
}

test('both palettes define the same opaque tokens and the light scheme is lighter', () => {
  for (const palette of Object.values(palettes)) {
    assert.deepEqual(Object.keys(palette.colors), themeColorNames);
    for (const value of [...Object.values(palette.colors), ...Object.values(palette.map)]) parseHex(value);
  }
  assert.ok(contrastRatio(palettes.light.colors.surface, '#000000') > contrastRatio(palettes.dark.colors.surface, '#000000'));
  assert.notEqual(palettes.dark.colors.surface.toUpperCase(), '#000000', 'dark surfaces are neutral, not pure black');
});

test('Tailwind semantic colours cover every token through its CSS variable', () => {
  const config = createRequire(import.meta.url)('../../tailwind.config.js') as { theme: { extend: { colors: Record<string, string>; textColor: Record<string, string> } } };
  const declared = new Map<string, string>([...Object.entries(config.theme.extend.colors), ...Object.entries(config.theme.extend.textColor).map(([name, value]) => [`text-${name}`, value] as [string, string])]);
  assert.deepEqual([...declared.keys()].sort(), themeColorNames.map(kebabTokenName).sort());
  for (const [name, value] of declared) assert.equal(value, `rgb(var(--color-${name}) / <alpha-value>)`);
  for (const scheme of ['light', 'dark'] as const) assert.deepEqual(Object.keys(themeVariables(scheme)).sort(), [...declared.keys()].map(name => `--color-${name}`).sort());
});

test('global.css light fallbacks match the light palette', () => {
  const css = readFileSync(new URL('../../global.css', import.meta.url), 'utf8');
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const declared = Object.fromEntries([...root.matchAll(/(--color-[a-z-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]!.trim()]));
  assert.deepEqual(declared, themeVariables('light'));
});

test('legacy tokens remain available for existing importers', () => {
  assert.deepEqual(Object.keys(legacyColors).sort(), ['amber', 'blue', 'ink', 'line', 'muted', 'paleBlue', 'paper', 'surface', 'teal']);
  assert.equal(legacyColors.blue, palettes.light.colors.action);
  assert.equal(legacyColors.ink, palettes.light.colors.textPrimary);
});
