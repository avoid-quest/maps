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

/**
 * A number's digit groups and the decimal/thousands separators between them ("4,2" → 4 | , | 2).
 * The separators stay inside the number, but Geist Mono gives a comma or point a full digit cell, so
 * "4,2 km" read as "4 , 2 km"; Num draws only the separator glyph in Geist Sans, keeping digits tabular.
 */
export function numberParts(number: string): { text: string; separator: boolean }[] {
  return [...number.matchAll(/(\d+)|([.,])/g)].map(match => ({ text: match[0], separator: match[2] !== undefined }));
}
