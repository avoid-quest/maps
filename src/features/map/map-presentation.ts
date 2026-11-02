/** Camera padding describes visible map space, never the height of a side sheet. */
export function mapCameraPadding({ width, height, sheetHeight, panelVisible, navigating, fontScale = 1 }: {
  width: number; height: number; sheetHeight: number; panelVisible: boolean; navigating: boolean; fontScale?: number;
}) {
  const top = navigating ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 28 : 112;
  if (navigating && width >= 650 && height < 500) return { top, right: 352, bottom: 32, left: 32 };
  const bottom = navigating ? Math.min(height * 0.46, 176 * Math.min(fontScale, 1.5)) + 28
    : panelVisible && width < 850 ? sheetHeight + 24 : 96;
  return { top, right: 32, bottom: Math.max(32, Math.min(bottom, height - top - 120)), left: width >= 850 && panelVisible && !navigating ? 442 : 32 };
}

/** Consume a planning frame once. A pan also consumes a pending frame before its response arrives. */
export function createRouteFraming() {
  let consumed: string | undefined;
  return {
    userMoved(key: string | undefined) { consumed = key; },
    claim(key: string | undefined, hasGeometry: boolean) {
      if (!key) { consumed = undefined; return false; }
      if (!hasGeometry || consumed === key) return false;
      consumed = key;
      return true;
    },
  };
}

type Bounds = [west: number, south: number, east: number, north: number];
const RESULT_FRAME_LIMIT = 10;
const RESULT_FRAME_RADIUS_DEGREES = 0.25;
const MIN_SPAN_DEGREES = 0.004;

/**
 * The area to frame for a submitted search: the leading results near the searched area. Far-away
 * online matches stay listed but do not zoom the map out to the whole country.
 */
export function resultFrameBounds(points: readonly { latitude: number; longitude: number }[], center: { latitude: number; longitude: number }): Bounds | null {
  const near = points.slice(0, RESULT_FRAME_LIMIT).filter(point =>
    Math.abs(point.latitude - center.latitude) <= RESULT_FRAME_RADIUS_DEGREES && Math.abs(point.longitude - center.longitude) <= RESULT_FRAME_RADIUS_DEGREES);
  const framed = near.length ? near : points.slice(0, 1);
  if (!framed.length) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of framed) {
    west = Math.min(west, point.longitude); east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude); north = Math.max(north, point.latitude);
  }
  const padLongitude = Math.max(0, (MIN_SPAN_DEGREES - (east - west)) / 2);
  const padLatitude = Math.max(0, (MIN_SPAN_DEGREES - (north - south)) / 2);
  return [west - padLongitude, south - padLatitude, east + padLongitude, north + padLatitude];
}

/** Closest zoom a result frame may reach: streets and labels stay readable around one or near-identical results. */
export const RESULT_MAX_ZOOM = 17;
const MIN_FIT_PIXELS = 96;
const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
const latitudeOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/**
 * The camera that fits `bounds` inside the padded viewport (MapLibre 512 px tiles), capped at
 * `maxZoom`. The fitted area never shrinks below a minimum, so a sheet or keyboard padding larger
 * than the map cannot drive the zoom to the maximum.
 */
export function frameCamera(bounds: Bounds, size: { width: number; height: number }, padding: { top?: number; right?: number; bottom?: number; left?: number } = {}, maxZoom = RESULT_MAX_ZOOM): { center: [number, number]; zoom: number } {
  const [west, south, east, north] = bounds;
  const width = Math.max(MIN_FIT_PIXELS, size.width - (padding.left ?? 0) - (padding.right ?? 0));
  const height = Math.max(MIN_FIT_PIXELS, size.height - (padding.top ?? 0) - (padding.bottom ?? 0));
  const spanX = Math.max(1e-9, (east - west) / 360);
  const spanY = Math.max(1e-9, (mercatorY(north) - mercatorY(south)) / (2 * Math.PI));
  const zoom = Math.min(maxZoom, Math.log2(Math.min(width / (spanX * 512), height / (spanY * 512))));
  return { center: [(west + east) / 2, latitudeOf((mercatorY(north) + mercatorY(south)) / 2)], zoom: Math.max(0, zoom) };
}

/**
 * One-shot framing for keys that only grow (submitted searches). Unlike route framing, an absent key
 * does not reset it: leaving and returning to a search the user already framed (or panned) never
 * moves the camera again.
 */
export function createOnceFraming() {
  const consumed = new Set<string>();
  return {
    userMoved(key: string | undefined) { if (key) consumed.add(key); },
    claim(key: string | undefined, ready: boolean) {
      if (!key || !ready || consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  };
}
