/**
 * Optional freshness mirrors for the GTT timetable manifest and hashed packages, tried in order
 * only when the previous one fails. Boards work fully without any of them: the bundled package,
 * GTT's own export (identity remap) and GTT realtime are enough. Package hashes make mirrors
 * interchangeable. The hosts are a deployment choice, configured only here.
 *
 * - `tree`: `<base>manifest.json` and `<base>packages/gtt-<sha256>.json` (GitHub Pages)
 * - `flat`: `<base>manifest.json` and `<base>gtt-<sha256>.json` (release assets cannot contain '/')
 */
export interface TimetableMirror {
  base: string;
  layout: 'tree' | 'flat';
  /** Hosts that also receive the request through redirects (for privacy notices). */
  redirectHosts?: readonly string[];
}
/**
 * No mirror is configured: GTT's static-export host refuses connections from GitHub-hosted
 * runners, so the CI pipeline cannot build packages (the workflow is disabled). Phones reach GTT
 * directly, so boards rely on the bundled package plus the identity remap read from GTT. To
 * re-enable, publish packages from a host that can reach GTT and list the mirrors here, e.g.
 * `{ base: 'https://avoid-quest.github.io/maps/gtt/', layout: 'tree' }`.
 */
export const TIMETABLE_MIRRORS: readonly TimetableMirror[] = [];

export const manifestUrl = (mirror: TimetableMirror) => `${mirror.base}manifest.json`;
/** `packagePath` is validated as `packages/gtt-<sha256>.json` before this is called. */
export const packageUrl = (mirror: TimetableMirror, packagePath: string) =>
  mirror.base + (mirror.layout === 'flat' ? packagePath.slice(packagePath.lastIndexOf('/') + 1) : packagePath);

/** Host names for privacy notices ("which server sees the request"). */
export function mirrorHosts(mirrors: readonly TimetableMirror[] = TIMETABLE_MIRRORS): string[] {
  return [...new Set(mirrors.flatMap(mirror => [mirror.base.replace(/^https?:\/\/([^/]+).*$/, '$1'), ...(mirror.redirectHosts ?? [])]))];
}

/** GTT's official static export: read directly (ranged) to remap rotated trip IDs. */
export const GTT_STATIC_ZIP = 'https://www.gtt.to.it/open_data/gtt_gtfs.zip';
/** GTT per-stop departures (opt-in only; reveals the viewed stop to GTT). */
export const GTT_STOP_ENDPOINT = 'https://www.gtt.to.it/cms/index.php';
