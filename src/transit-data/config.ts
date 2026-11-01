/**
 * Where the app looks for the GTT timetable manifest and hashed packages: an ordered list of
 * mirror base URLs (each ending in '/'), tried in order only when the previous one fails. Every
 * mirror must serve the same `manifest.json` and `packages/gtt-<sha256>.json` layout; package
 * hashes make mirrors interchangeable. The host is a deployment choice, configured only here.
 */
export const TIMETABLE_MIRRORS: readonly string[] = ['https://avoid-quest.github.io/maps/gtt/'];

/** Host names for privacy notices ("which server sees the request"). */
export function mirrorHosts(mirrors: readonly string[] = TIMETABLE_MIRRORS): string[] {
  return mirrors.map(base => base.replace(/^https?:\/\/([^/]+).*$/, '$1'));
}
