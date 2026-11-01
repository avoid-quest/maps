/**
 * Splits text into digit runs and everything else. Geist Mono gives every glyph a full cell, so a space
 * before a unit ("64 m") or a colon ("23:33") looked like a double gap; digits stay monospaced and
 * tabular while separators and units are set in Geist Sans.
 */
export function numericRuns(text: string): { text: string; numeric: boolean }[] {
  const runs: { text: string; numeric: boolean }[] = [];
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)*)|([^\d]+)/g)) {
    const numeric = match[1] !== undefined;
    runs.push({ text: match[0], numeric });
  }
  return runs;
}
