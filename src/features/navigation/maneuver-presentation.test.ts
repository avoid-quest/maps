import test from 'node:test';
import assert from 'node:assert/strict';
import type { GuidanceManeuver, NavigationSnapshot } from '../../domain/navigation';
import { idleNavigation } from '../../domain/navigation';
import { bannerDistance, maneuverGlyph, maneuverLines, thenManeuver } from './maneuver-presentation';

const m = (type: string, more: Partial<GuidanceManeuver> = {}): GuidanceManeuver => ({ id: '1:1', stepIndex: 1, geometryIndex: 3, type, instruction: 'x', ...more });

test('glyphs come from OSRM type and modifier; right turns mirror the left artwork', () => {
  assert.deepEqual(maneuverGlyph(m('turn', { modifier: 'right' })), { name: 'left', mirror: true, label: 'Svolta a destra' });
  assert.deepEqual(maneuverGlyph(m('turn', { modifier: 'slight left' })), { name: 'slight-left', mirror: false, label: 'Svolta leggermente a sinistra' });
  assert.equal(maneuverGlyph(m('end of road', { modifier: 'sharp right' })).name, 'sharp-left');
  assert.equal(maneuverGlyph(m('new name', { modifier: 'straight' })).name, 'straight');
  assert.deepEqual(maneuverGlyph(m('continue', { modifier: 'uturn', drivingSide: 'right' })), { name: 'uturn-left', mirror: false, label: 'Inversione di marcia' });
  assert.equal(maneuverGlyph(m('continue', { modifier: 'uturn', drivingSide: 'left' })).mirror, true);
  assert.equal(maneuverGlyph(m('fork', { modifier: 'slight right' })).name, 'fork-left');
  assert.equal(maneuverGlyph(m('merge', { modifier: 'slight left' })).name, 'merge-left');
  assert.equal(maneuverGlyph(m('off ramp', { modifier: 'right' })).mirror, true);
  assert.deepEqual(maneuverGlyph(m('arrive', { modifier: 'right' })), { name: 'arrive-left', mirror: true, label: 'Destinazione a destra' });
  assert.equal(maneuverGlyph(m('arrive')).name, 'arrive');
});

test('roundabouts show exit number and circulation; left-hand traffic mirrors', () => {
  assert.deepEqual(maneuverGlyph(m('roundabout', { modifier: 'right', exit: 2, drivingSide: 'right' })),
    { name: 'roundabout-right', mirror: false, exit: 2, label: 'Rotatoria, uscita 2' });
  assert.equal(maneuverGlyph(m('rotary', { modifier: 'left', exit: 4 })).name, 'roundabout-left');
  assert.equal(maneuverGlyph(m('roundabout', { modifier: 'straight', exit: 3 })).name, 'roundabout-straight');
  const clockwise = maneuverGlyph(m('roundabout', { modifier: 'right', exit: 1, drivingSide: 'left' }));
  assert.deepEqual([clockwise.name, clockwise.mirror], ['roundabout-left', true], 'mirrored left exit = clockwise right exit');
});

test('unknown types or missing modifiers never become guessed turns', () => {
  for (const maneuver of [m('future maneuver', { modifier: 'left' }), m('turn'), m('fork'), m('roundabout', { exit: 2 }), undefined]) {
    assert.equal(maneuverGlyph(maneuver).name, 'unknown');
  }
  assert.equal(maneuverGlyph(m('roundabout', { exit: 2 })).exit, 2, 'the supplied exit number is still shown');
});

test('banner distance: coarse steps, subordinate unit, Italian decimal comma', () => {
  assert.deepEqual(bannerDistance(42), { value: '40', unit: 'm', label: '40 metri' });
  assert.deepEqual(bannerDistance(2), { value: '0', unit: 'm', label: '0 metri' });
  assert.deepEqual(bannerDistance(347), { value: '350', unit: 'm', label: '350 metri' });
  assert.deepEqual(bannerDistance(998), { value: '1', unit: 'km', label: '1 chilometro' });
  assert.deepEqual(bannerDistance(1260), { value: '1,3', unit: 'km', label: '1,3 chilometri' });
  assert.deepEqual(bannerDistance(2000), { value: '2', unit: 'km', label: '2 chilometri' });
  assert.equal(bannerDistance(Number.NaN).value, '–');
});

test('street and action lines split only the supplied street suffix', () => {
  assert.deepEqual(maneuverLines(m('turn', { name: 'Via Roma', instruction: 'Svolta a destra su Via Roma' }), undefined), { primary: 'Via Roma', secondary: 'Svolta a destra' });
  assert.deepEqual(maneuverLines(m('turn', { instruction: 'Svolta a destra' }), undefined), { primary: 'Svolta a destra', secondary: null });
  assert.deepEqual(maneuverLines(undefined, 'Stai arrivando a destinazione'), { primary: 'Stai arrivando a destinazione', secondary: null });
});

test('"Poi" uses the gap between maneuvers, not proximity', () => {
  const base: NavigationSnapshot = { ...idleNavigation, status: 'navigating', mode: 'car', upcomingManeuver: m('turn', { modifier: 'right' }) };
  const following = { ...m('turn', { id: '1:2', modifier: 'left' }), afterUpcomingMeters: 40, afterUpcomingSeconds: 6 };
  assert.equal(thenManeuver({ ...base, followingManeuver: following })?.id, '1:2');
  assert.equal(thenManeuver({ ...base, followingManeuver: { ...following, afterUpcomingMeters: 600, afterUpcomingSeconds: 45 } }), null);
  assert.equal(thenManeuver({ ...base, distanceToManeuverMeters: 5, followingManeuver: { ...following, afterUpcomingMeters: 600, afterUpcomingSeconds: 45 } }), null, 'being close to the first turn is irrelevant');
});
