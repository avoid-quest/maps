import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every wrapper between the sheet and its scrollers can shrink (scroll regression)', () => {
  // The library sizes its content box after the first layout pass; a plain flex: 1 wrapper keeps its
  // content height, so the scroller's viewport equals its content and nothing can scroll.
  const sheet = read('ui/Sheet.tsx');
  assert.match(sheet, /export const SHRINKING_FILL = \{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 \}/);
  assert.match(sheet, /<View testID=\{testID\} style=\{\[SHRINKING_FILL/, 'the sheet body wrapper');
  assert.match(sheet, /<BottomSheetScrollView style=\{SHRINKING_FILL\}/, 'SheetScrollView');
  assert.match(sheet, /style=\{\[SHRINKING_FILL, props\.style\]\}/, 'SheetFlatList');
  const taskSheet = read('features/app/TaskSheet.tsx');
  assert.match(taskSheet, /<View key=\{detailKey\(tasks\)\} style=\{SHRINKING_FILL\}>/, 'the task content wrapper');
  for (const [name, text] of [['Sheet.tsx', sheet], ['TaskSheet.tsx', taskSheet]] as const) {
    assert.doesNotMatch(text, /style=\{\{ flex: 1/, `${name} has no non-shrinking flex: 1 wrapper`);
  }
});

test('pressable content never grows inside scroll content', () => {
  // A growable child absorbed the scroll content's spare height during the sheet's first layout pass.
  const surface = read('ui/PressableSurface.tsx');
  const pressable = /<Pressable\b[^>]*>/.exec(surface)?.[0] ?? '';
  assert.doesNotMatch(pressable, /\bgrow\b|flex-1|flexGrow/);
});
