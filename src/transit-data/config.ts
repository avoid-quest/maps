/**
 * Optional freshness mirrors for the GTT timetable manifest and hashed packages, tried in order
 * only when the previous one fails. Boards work fully without any of them: the bundled package,
 * GTT's own export (identity remap) and GTT realtime are enough. Package hashes make mirrors
 * interchangeable. The hosts are a deployment choice, configured only here.
 *
 * - `tree`: `<base>manifest.json` and `<base>packages/gtt-<sha256>.json` (GitHub Pages)
 * - `flat`: `<base>manifest.json` and `<base>gtt-<sha256>.json` (release assets cannot contain '/')
 */
export interface TimetableMirror { base: string; layout: 'tree' | 'flat' }
export const TIMETABLE_MIRRORS: readonly TimetableMirror[] = [
  { base: 'https://avoid-quest.github.io/maps/gtt/', layout: 'tree' },
  // Assets of the rolling `gtt-timetable` prerelease (never marked "latest").
  { base: 'https://github.com/avoid-quest/maps/releases/download/gtt-timetable/', layout: 'flat' },
];

export const manifestUrl = (mirror: TimetableMirror) => `${mirror.base}manifest.json`;
/** `packagePath` is validated as `packages/gtt-<sha256>.json` before this is called. */
export const packageUrl = (mirror: TimetableMirror, packagePath: string) =>
  mirror.base + (mirror.layout === 'flat' ? packagePath.slice(packagePath.lastIndexOf('/') + 1) : packagePath);

/** Host names for privacy notices ("which server sees the request"). */
export function mirrorHosts(mirrors: readonly TimetableMirror[] = TIMETABLE_MIRRORS): string[] {
  return [...new Set(mirrors.map(mirror => mirror.base.replace(/^https?:\/\/([^/]+).*$/, '$1')))];
}

/** GTT's official static export: read directly (ranged) to remap rotated trip IDs. */
export const GTT_STATIC_ZIP = 'https://www.gtt.to.it/open_data/gtt_gtfs.zip';
/** GTT per-stop departures (opt-in only; reveals the viewed stop to GTT). */
export const GTT_STOP_ENDPOINT = 'https://www.gtt.to.it/cms/index.php';
