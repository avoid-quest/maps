/**
 * The task sheet rests at one of three heights. `peek` shows the title and the first row of content,
 * `half` shares the screen with the map, `full` leaves only the search bar and a strip of map.
 */
export const SHEET_SNAPS = ['peek', 'half', 'full'] as const;
export type SheetSnap = typeof SHEET_SNAPS[number];
export type SheetHeights = Record<SheetSnap, number>;
export const SHEET_SNAP_LABELS: Record<SheetSnap, string> = { peek: 'compatta', half: 'a metà schermo', full: 'espansa' };

/**
 * Physical snap points for the gesture library: strictly increasing and without duplicates. In a short
 * window two logical snaps can share a height (e.g. peek = half = 220 with the keyboard open); the
 * library resolves a position to the first matching index, so duplicates would report the wrong snap.
 */
export function physicalSnaps(heights: SheetHeights): number[] {
  return [...new Set(SHEET_SNAPS.map(snap => heights[snap]))].sort((a, b) => a - b);
}

export function physicalIndex(heights: SheetHeights, snap: SheetSnap): number {
  return physicalSnaps(heights).indexOf(heights[snap]);
}

/**
 * The logical snap for a physical index the sheet reached. The current snap is kept when it shares that
 * height; otherwise moving up lands on the highest logical snap at that height, moving down on the lowest.
 */
export function logicalSnapAt(heights: SheetHeights, index: number, current: SheetSnap): SheetSnap {
  const height = physicalSnaps(heights)[index];
  if (height === undefined || heights[current] === height) return current;
  const candidates = SHEET_SNAPS.filter(snap => heights[snap] === height);
  return height > heights[current] ? candidates[candidates.length - 1]! : candidates[0]!;
}

/** The next snap with a visibly different height in `direction`, or the snap itself at either end. */
export function distinctSnap(heights: SheetHeights, snap: SheetSnap, direction: 1 | -1): SheetSnap {
  const ordered = direction === 1 ? SHEET_SNAPS : [...SHEET_SNAPS].reverse();
  return ordered.slice(ordered.indexOf(snap) + 1).find(next => heights[next] !== heights[snap]) ?? snap;
}
