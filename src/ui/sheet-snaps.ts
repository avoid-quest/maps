/**
 * The task sheet rests at one of three heights. `peek` shows the title and the first row of content,
 * `half` shares the screen with the map, `full` leaves only the search bar and a strip of map.
 */
export const SHEET_SNAPS = ['peek', 'half', 'full'] as const;
export type SheetSnap = typeof SHEET_SNAPS[number];
export type SheetHeights = Record<SheetSnap, number>;
export const SHEET_SNAP_LABELS: Record<SheetSnap, string> = { peek: 'compatta', half: 'a metà schermo', full: 'espansa' };
