import type { CameraFrame, CameraIntent } from './guidance-camera';
import type { Padding } from './map-projection';

export interface GuidanceFit { key: string; bounds: [number, number, number, number]; padding: Padding }
export interface IssuedCommands { frame: string | null; overview: string | null; fit: string | null }
export type GuidanceCommand =
  | { kind: 'frame'; key: string; frame: CameraFrame }
  | { kind: 'overview' | 'fit'; key: string; fit: GuidanceFit };

/**
 * The one camera command guidance should issue now, if any: the follow frame (road or transit
 * walking), otherwise the transit leg fit while following, or the overview once per request. Free
 * issues nothing, and neither does a gesture still in progress. A key is issued at most once; an
 * explicit Ricentra changes the follow frame key and the leg fit key, so it always moves the map.
 */
export function pendingGuidanceCommand(state: {
  intent: CameraIntent; frame: CameraFrame | null; overview: GuidanceFit | null; fit: GuidanceFit | null; gesture: boolean;
}, issued: IssuedCommands): GuidanceCommand | null {
  if (state.intent === 'overview') {
    return state.overview && issued.overview !== state.overview.key ? { kind: 'overview', key: state.overview.key, fit: state.overview } : null;
  }
  if (state.intent !== 'follow' || state.gesture) return null;
  if (state.frame) return issued.frame !== state.frame.key ? { kind: 'frame', key: state.frame.key, frame: state.frame } : null;
  return state.fit && issued.fit !== state.fit.key ? { kind: 'fit', key: state.fit.key, fit: state.fit } : null;
}

/** Leg fit identity: one per leg, and again after every explicit recenter request. */
export const legFitKey = (sessionId: string | null, legKey: string, recenter: number) => `leg:${sessionId}:${legKey}:${recenter}`;
