import type { GuidanceMapState } from '../navigation/useGuidanceCamera';

/** Guidance route, casing and turn arrow sit directly before street names, so labels stay readable over the line. */
export const GUIDANCE_ROUTE_BEFORE = 'highway-name-path';
/** The brand basemap's hidden navigation-only extrusion of supplied building heights. */
export const BUILDING_EXTRUSION_LAYER = 'avoid_building_3d';

export interface GuidanceBasemap {
  /** Generic business dots and labels hidden while driving or cycling; street names stay. */
  reduceBusinesses: boolean;
  /** One-way chevrons while driving. */
  oneWayArrows: boolean;
  /** Navigation buildings in road modes and transit walks; overview stays flat. */
  buildings: boolean;
}

/** Basemap adjustments for the current guidance state; browsing and planning keep the flat, complete basemap. */
export function guidanceBasemap(guidance: Pick<GuidanceMapState, 'mode' | 'intent'> | null | undefined): GuidanceBasemap {
  const mode = guidance?.mode ?? null;
  return { reduceBusinesses: mode === 'car' || mode === 'bicycle', oneWayArrows: mode === 'car', buildings: mode !== null && guidance?.intent !== 'overview' };
}
