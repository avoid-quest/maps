import type { Coordinate } from '../../domain/types';

/**
 * Screen projection matching MapLibre's transform (512 px tiles, vertical field of view 36.87°,
 * camera distance from the full viewport height, padding as a principal-point offset). The camera
 * planner uses it to place the puck and to check that a junction is framed before issuing a move;
 * device runs compare it with `MapRef.project`.
 */
export interface ScreenSize { width: number; height: number }
export interface Padding { top: number; right: number; bottom: number; left: number }
export interface CameraPose { center: Coordinate; zoom: number; bearing: number; pitch: number; padding: Padding }
export interface ScreenPoint { x: number; y: number }

const FIELD_OF_VIEW = 0.6435011087932844;
const TILE = 512;
const rad = (degrees: number) => degrees * Math.PI / 180;

function world(point: Coordinate, zoom: number) {
  const size = TILE * 2 ** zoom;
  const latitude = Math.max(-85.051129, Math.min(85.051129, point.latitude));
  return {
    x: ((point.longitude + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(Math.PI / 4 + rad(latitude) / 2)) / Math.PI) / 2) * size,
  };
}

/** Screen point of the padded centre: where the camera's `center` coordinate is drawn. */
export function principalPoint(size: ScreenSize, padding: Padding): ScreenPoint {
  return { x: size.width / 2 + (padding.left - padding.right) / 2, y: size.height / 2 + (padding.top - padding.bottom) / 2 };
}

/** Projects a ground coordinate; `null` behind the camera or beyond the horizon. */
export function project(pose: CameraPose, size: ScreenSize, point: Coordinate): ScreenPoint | null {
  const c = world(pose.center, pose.zoom);
  const p = world(point, pose.zoom);
  const dx = p.x - c.x; const dy = p.y - c.y;
  const b = rad(pose.bearing); const pitch = rad(pose.pitch);
  const right = dx * Math.cos(b) + dy * Math.sin(b);
  const forward = dx * Math.sin(b) - dy * Math.cos(b);
  const distance = 0.5 * size.height / Math.tan(FIELD_OF_VIEW / 2);
  const depth = distance + forward * Math.sin(pitch);
  if (depth <= distance * 0.05) return null;
  const principal = principalPoint(size, pose.padding);
  return { x: principal.x + right * distance / depth, y: principal.y - forward * Math.cos(pitch) * distance / depth };
}

/**
 * Padding that draws the camera centre at `anchorY` (screen y, from the top). MapLibre centres the
 * padded rectangle, so a LOW anchor needs TOP padding: bottom padding alone moves the centre up.
 */
export function paddingForAnchor(size: ScreenSize, anchorY: number): Padding {
  const y = Math.max(0, Math.min(size.height, anchorY));
  return { top: Math.max(0, 2 * y - size.height), right: 0, bottom: Math.max(0, size.height - 2 * y), left: 0 };
}

export interface VisibleRect { left: number; top: number; right: number; bottom: number }
export const inside = (point: ScreenPoint | null, rect: VisibleRect) => point !== null
  && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

/** Metres per screen point at the centre (MapLibre logical points). */
export function metersPerPoint(latitude: number, zoom: number): number {
  return 40_075_016.686 * Math.cos(rad(latitude)) / (TILE * 2 ** zoom);
}
