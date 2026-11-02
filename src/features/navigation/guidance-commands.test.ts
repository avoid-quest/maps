import test from 'node:test';
import assert from 'node:assert/strict';
import { legFitKey, pendingGuidanceCommand, type GuidanceFit, type IssuedCommands } from './guidance-commands';
import { GuidanceCamera } from './guidance-camera';
import { routeFixture, trajectory } from './guidance-fixtures';

const padding = { top: 0, right: 0, bottom: 0, left: 0 };
const leg = (recenter: number): GuidanceFit => ({ key: legFitKey('s1', '2', recenter), bounds: [7.6, 45, 7.7, 45.1], padding });
const none: IssuedCommands = { frame: null, overview: null, fit: null };

test('transit ride: the leg is fitted once, a pan blocks it, and Ricentra fits it again', () => {
  const first = pendingGuidanceCommand({ intent: 'follow', frame: null, overview: null, fit: leg(0), gesture: false }, none);
  assert.equal(first?.kind, 'fit');
  const issued = { ...none, fit: first!.key };
  assert.equal(pendingGuidanceCommand({ intent: 'follow', frame: null, overview: null, fit: leg(0), gesture: false }, issued), null, 'once per leg');
  assert.equal(pendingGuidanceCommand({ intent: 'free', frame: null, overview: null, fit: leg(0), gesture: true }, issued), null, 'free issues nothing');
  // Ricentra: follow again with the recenter counter in the fit identity.
  const again = pendingGuidanceCommand({ intent: 'follow', frame: null, overview: null, fit: leg(1), gesture: false }, issued);
  assert.deepEqual([again?.kind, again?.key], ['fit', 'leg:s1:2:1']);
});

test('road follow issues each frame once, Ricentra frames anew, overview once per request', () => {
  const camera = new GuidanceCamera();
  const frame = camera.update(trajectory(routeFixture([{ bearing: 0, meters: 300 }]), { mode: 'car', speed: 10, seconds: 1 })[0]!)!;
  const command = pendingGuidanceCommand({ intent: 'follow', frame, overview: null, fit: null, gesture: false }, none);
  assert.equal(command?.kind, 'frame');
  const issued = { ...none, frame: frame.key };
  assert.equal(pendingGuidanceCommand({ intent: 'follow', frame, overview: null, fit: null, gesture: false }, issued), null);
  assert.equal(pendingGuidanceCommand({ intent: 'follow', frame, overview: null, fit: null, gesture: true }, none), null, 'a gesture blocks pending moves');
  const recentred = camera.recenter()!;
  assert.equal(pendingGuidanceCommand({ intent: 'follow', frame: recentred, overview: null, fit: null, gesture: false }, issued)?.kind, 'frame');
  const overview: GuidanceFit = { key: 'overview:1', bounds: [7.6, 45, 7.7, 45.1], padding };
  assert.equal(pendingGuidanceCommand({ intent: 'overview', frame, overview, fit: null, gesture: false }, issued)?.kind, 'overview');
  assert.equal(pendingGuidanceCommand({ intent: 'overview', frame, overview, fit: null, gesture: false }, { ...issued, overview: 'overview:1' }), null);
});
