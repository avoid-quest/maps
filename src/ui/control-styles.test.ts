import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../theme/contrast';
import { palettes } from '../theme/palette';
import { buttonColors, chipColors, floatingControlColors, rowDividerColors, segmentColors, switchColors } from './control-styles';

const [light, dark] = [palettes.light.colors, palettes.dark.colors];

test('floating map buttons and row dividers resolve to each scheme\'s own palette (live switch regression)', () => {
  // Rendered under light, then dark: the colours must follow the scheme, never a value captured earlier.
  assert.deepEqual(floatingControlColors(light, false), { backgroundColor: light.surfaceRaised, borderColor: light.divider });
  assert.deepEqual(floatingControlColors(dark, false), { backgroundColor: dark.surfaceRaised, borderColor: dark.divider });
  assert.notEqual(floatingControlColors(light, false).backgroundColor, floatingControlColors(dark, false).backgroundColor);
  assert.deepEqual(rowDividerColors(light), { borderBottomColor: light.divider });
  assert.deepEqual(rowDividerColors(dark), { borderBottomColor: dark.divider });
  assert.notEqual(rowDividerColors(light).borderBottomColor, rowDividerColors(dark).borderBottomColor);
  assert.equal(floatingControlColors(dark, true).backgroundColor, dark.actionSubtle);
});

test('controls stay legible in both schemes: the white/black pill, chips, segments and floating icons', () => {
  for (const colors of [light, dark]) {
    const primary = buttonColors(colors, 'primary');
    assert.ok(contrastRatio(primary.foreground, primary.backgroundColor) >= AA_TEXT, 'pill label');
    for (const variant of ['secondary', 'quiet'] as const) {
      assert.ok(contrastRatio(buttonColors(colors, variant).foreground, colors.surface) >= AA_TEXT, `${variant} label on the sheet`);
    }
    assert.ok(contrastRatio(buttonColors(colors, 'secondary').borderColor, colors.surface) >= AA_NON_TEXT, 'secondary outline is visible');
    const selected = chipColors(colors, true);
    assert.ok(contrastRatio(selected.foreground, selected.backgroundColor) >= AA_TEXT);
    assert.ok(contrastRatio(segmentColors(colors, true).foreground, colors.surfaceRaised) >= AA_TEXT);
    assert.ok(contrastRatio(segmentColors(colors, false).foreground, colors.surfaceMuted) >= AA_TEXT);
    assert.ok(contrastRatio(colors.textPrimary, floatingControlColors(colors, false).backgroundColor) >= AA_TEXT, 'floating icon');
  }
  for (const colors of [light, dark]) {
    const off = switchColors(colors, false); const on = switchColors(colors, true);
    assert.ok(contrastRatio(off.trackColor.false, colors.surface) >= AA_NON_TEXT, 'the off track is visible against the sheet');
    assert.ok(contrastRatio(off.thumbColor, off.trackColor.false) >= AA_NON_TEXT, 'the off thumb is visible on its track');
    assert.ok(contrastRatio(on.thumbColor, on.trackColor.true) >= AA_NON_TEXT, 'the on thumb is visible on its track');
  }
  assert.equal(buttonColors(dark, 'primary').backgroundColor, dark.action, 'dark primary is the white pill');
  assert.equal(buttonColors(light, 'primary').backgroundColor, light.action, 'light primary is the black pill');
});

const src = new URL('../', import.meta.url).pathname;
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'data' ? [] : sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

test('pressables and dividers take colours from the palette inline, never from NativeWind classes', () => {
  const colourClass = /\b(?:bg|border)-(?:surface|surface-raised|surface-muted|chrome|action|action-subtle|divider|caution|danger|success)\b/;
  const problems: string[] = [];
  for (const file of sources(src)) {
    const text = readFileSync(file, 'utf8');
    const name = relative(src, file);
    if (/\bborder-divider\b/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) problems.push(`${name}: border-divider class (use useHairlines)`);
    // The opening tag up to its className, without crossing into child elements (arrow functions are fine).
    for (const match of text.matchAll(/<Pressable\b[^<]*?className=(\{`[^`]*`\}|"[^"]*")/g)) {
      const classes = match[1]!;
      if (colourClass.test(classes)) problems.push(`${name}: Pressable with colour class ${classes}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('ripples never share a view with a themed fill or border (live switch regression on Android)', () => {
  // RN 0.81 drops redraws of a view's background colour once android_ripple sets a feedback underlay.
  const offenders = sources(src).filter(file => !file.endsWith('ui/PressableSurface.tsx') && /android_ripple/.test(readFileSync(file, 'utf8')))
    .map(file => relative(src, file));
  assert.deepEqual(offenders, [], 'use PressableSurface for pressables with ripple feedback');
  const surface = readFileSync(join(src, 'ui/PressableSurface.tsx'), 'utf8');
  const inner = /<Pressable\b[^>]*>/.exec(surface)?.[0] ?? '';
  assert.ok(inner.includes('android_ripple') && !/\bstyle=|backgroundColor|border(?:Color|Width)/.test(inner), 'the rippling Pressable carries no colours');
  const metro = readFileSync(new URL('../../metro.config.js', import.meta.url), 'utf8');
  assert.match(metro, /inlineRem: 16/, 'native rem is 16 so text-base is 16 sp and h-12 is 48 dp');
});
