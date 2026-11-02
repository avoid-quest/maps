import type { GuidanceManeuver, ManeuverModifier, NavigationSnapshot } from '../../domain/navigation';
import { CAMERA_PROFILES, followsClosely, type CameraMode } from './guidance-camera';

/** Glyph names rendered by scripts/render-navigation-assets.mjs (drawn for left turns, right-hand traffic). */
export type GlyphName = 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'uturn-left' | 'fork-left' | 'merge-left' | 'ramp-left'
  | 'roundabout-right' | 'roundabout-slight-right' | 'roundabout-straight' | 'roundabout-slight-left' | 'roundabout-left'
  | 'roundabout-sharp-left' | 'roundabout-uturn' | 'arrive' | 'arrive-left' | 'unknown';
export interface ManeuverGlyph {
  name: GlyphName;
  /** Mirror horizontally: right turns, or clockwise circulation in left-hand traffic. */
  mirror: boolean;
  /** Roundabout exit number shown beside the glyph. */
  exit?: number;
  /** Spoken description of the glyph for TalkBack. */
  label: string;
}

const side = (modifier: ManeuverModifier | undefined): 'left' | 'right' | null =>
  modifier === 'left' || modifier === 'slight left' || modifier === 'sharp left' ? 'left'
    : modifier === 'right' || modifier === 'slight right' || modifier === 'sharp right' ? 'right' : null;
const flip = (modifier: ManeuverModifier): ManeuverModifier => modifier.includes('left')
  ? modifier.replace('left', 'right') as ManeuverModifier : modifier.includes('right') ? modifier.replace('right', 'left') as ManeuverModifier : modifier;

const TURN_TYPES = new Set(['turn', 'continue', 'end of road', 'new name', 'notification', 'use lane', 'exit roundabout', 'exit rotary', 'depart']);
const ROUNDABOUT_TYPES = new Set(['roundabout', 'rotary', 'roundabout turn']);
const unknownGlyph: ManeuverGlyph = { name: 'unknown', mirror: false, label: 'Manovra' };

/**
 * The banner glyph from raw OSRM facts. A missing or unfamiliar type or modifier gives the neutral
 * glyph with the supplied text; a turn direction is never guessed.
 */
export function maneuverGlyph(maneuver: GuidanceManeuver | undefined): ManeuverGlyph {
  if (!maneuver) return unknownGlyph;
  const { type, modifier } = maneuver;
  const leftHand = maneuver.drivingSide === 'left';
  if (type === 'arrive') {
    const where = side(modifier);
    return where ? { name: 'arrive-left', mirror: where === 'right', label: `Destinazione a ${where === 'left' ? 'sinistra' : 'destra'}` }
      : { name: 'arrive', mirror: false, label: 'Destinazione' };
  }
  if (ROUNDABOUT_TYPES.has(type)) {
    if (!modifier) return { ...unknownGlyph, ...(maneuver.exit ? { exit: maneuver.exit } : {}), label: 'Rotatoria' };
    // Left-hand traffic circulates clockwise: the mirrored glyph of the mirrored exit direction.
    const seen = leftHand ? flip(modifier) : modifier;
    const name: GlyphName = seen === 'uturn' ? 'roundabout-uturn' : seen === 'straight' ? 'roundabout-straight'
      : (`roundabout-${seen.replace(' ', '-')}` as GlyphName);
    const known: GlyphName[] = ['roundabout-right', 'roundabout-slight-right', 'roundabout-straight', 'roundabout-slight-left', 'roundabout-left', 'roundabout-sharp-left', 'roundabout-uturn'];
    const resolved = known.includes(name) ? name : seen === 'sharp right' ? 'roundabout-right' : 'roundabout-straight';
    return { name: resolved, mirror: leftHand, ...(maneuver.exit ? { exit: maneuver.exit } : {}), label: `Rotatoria${maneuver.exit ? `, uscita ${maneuver.exit}` : ''}` };
  }
  const where = side(modifier);
  const mirror = where === 'right';
  if (type === 'fork') return where ? { name: 'fork-left', mirror, label: `Bivio, tieni la ${where === 'left' ? 'sinistra' : 'destra'}` } : unknownGlyph;
  if (type === 'merge') return where ? { name: 'merge-left', mirror, label: `Immettiti a ${where === 'left' ? 'sinistra' : 'destra'}` } : { name: 'straight', mirror: false, label: 'Immettiti' };
  if (type === 'on ramp' || type === 'off ramp') return where ? { name: 'ramp-left', mirror, label: `Rampa a ${where === 'left' ? 'sinistra' : 'destra'}` } : unknownGlyph;
  if (!TURN_TYPES.has(type) || !modifier) return unknownGlyph;
  if (modifier === 'straight') return { name: 'straight', mirror: false, label: 'Dritto' };
  if (modifier === 'uturn') return { name: 'uturn-left', mirror: leftHand, label: 'Inversione di marcia' };
  const degree = modifier.startsWith('slight') ? 'slight-left' : modifier.startsWith('sharp') ? 'sharp-left' : 'left';
  const words = { 'slight-left': 'leggermente ', 'sharp-left': 'nettamente ', left: '' }[degree];
  return { name: degree, mirror, label: `Svolta ${words}a ${where === 'left' ? 'sinistra' : 'destra'}` };
}

/**
 * Banner distance: a number and a subordinate unit. Steps of 5 m below 100 m, 10 m below 1 km,
 * then tenths of a kilometre; never more precise than guidance can be.
 */
export function bannerDistance(meters: number): { value: string; unit: string; label: string } {
  if (!Number.isFinite(meters) || meters < 0) return { value: '–', unit: '', label: '' };
  if (meters < 1000) {
    const step = meters < 100 ? 5 : 10;
    const value = Math.max(0, Math.round(meters / step) * step);
    if (value >= 1000) return { value: '1', unit: 'km', label: '1 chilometro' };
    return { value: String(value), unit: 'm', label: `${value} metri` };
  }
  const km = (Math.round(meters / 100) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
  return { value: km, unit: 'km', label: km === '1' ? '1 chilometro' : `${km} chilometri` };
}

/**
 * Street (primary) and action (secondary) lines. The street is the supplied OSRM name; the action is
 * the native Italian instruction with that name's " su <nome>" suffix removed, never re-derived.
 */
export function maneuverLines(maneuver: GuidanceManeuver | undefined, instruction: string | undefined): { primary: string; secondary: string | null } {
  const text = maneuver?.instruction ?? instruction ?? '';
  const name = maneuver?.name ?? (maneuver?.ref ?? undefined);
  if (name) {
    const suffix = ` su ${name}`;
    const action = text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
    return { primary: name, secondary: action && action !== name ? action : null };
  }
  return { primary: text, secondary: null };
}

/** "Poi …" only when the following maneuver comes within about ten seconds of travel. */
export function thenManeuver(snapshot: NavigationSnapshot): GuidanceManeuver | null {
  const mode = snapshot.mode === 'walk' || snapshot.mode === 'bicycle' || snapshot.mode === 'car' ? snapshot.mode as CameraMode : null;
  const following = snapshot.followingManeuver;
  if (!mode || !following || !snapshot.upcomingManeuver) return null;
  const speed = Math.max(CAMERA_PROFILES[mode].typicalSpeed, snapshot.location?.speedMps ?? 0);
  return followsClosely(following, speed) ? following : null;
}
