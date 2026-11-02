import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_PROFILES, followsClosely, framesManeuver, GuidanceCamera, nextIntent, overviewBounds, type CameraFrame, type CameraInput } from './guidance-camera';
import { maneuverPoint, PHONE, routeFixture, trajectory, TURIN } from './guidance-fixtures';
import { inside, paddingForAnchor, principalPoint, project } from './map-projection';
import { angleDelta, distanceMeters, offsetCoordinate, offsetOfIndex } from './route-measure';

const run = (inputs: CameraInput[]) => { const camera = new GuidanceCamera(); return inputs.map(input => camera.update(input)!); };
const rect = { left: 16, right: PHONE.width - 16, top: PHONE.top + 12, bottom: PHONE.bottom - 12 };
const size = { width: PHONE.width, height: PHONE.height };
const anchorOf = (frame: CameraFrame) => project(frame, size, frame.center)!;

test('padding draws the camera centre at a low anchor under pitch; bottom padding alone would move it up', () => {
  for (const pitch of [0, 30, 48]) {
    const padding = paddingForAnchor(size, 0.72 * PHONE.height);
    const point = project({ center: TURIN, zoom: 17, bearing: 33, pitch, padding }, size, TURIN)!;
    assert.ok(Math.abs(point.y - 0.72 * PHONE.height) < 0.01 && Math.abs(point.x - PHONE.width / 2) < 0.01);
    const ahead = project({ center: TURIN, zoom: 17, bearing: 0, pitch, padding }, size, offsetCoordinate(TURIN, 0, 50))!;
    assert.ok(ahead.y < point.y, 'a point ahead is drawn above the puck');
  }
  assert.ok(principalPoint(size, { top: 0, right: 0, bottom: 200, left: 0 }).y < PHONE.height / 2, 'bottom padding raises the centre');
});

test('straight cruise: course-up, steady zoom and the puck on its mode anchor', () => {
  const fixture = routeFixture([{ bearing: 20, meters: 900 }]);
  for (const [mode, speed] of [['walk', 1.4], ['bicycle', 5], ['car', 12]] as const) {
    const frames = run(trajectory(fixture, { mode, speed, seconds: 25 }));
    const steady = frames.slice(5);
    const profile = CAMERA_PROFILES[mode];
    const target = PHONE.top + profile.anchor * (PHONE.bottom - PHONE.top);
    for (const frame of steady) {
      assert.ok(Math.abs(angleDelta(frame.bearing, 20)) < 1, `${mode} bearing ${frame.bearing}`);
      assert.equal(frame.pitch, profile.pitch);
      // ±3% of the unobscured height: here exact, the camera centre is the puck.
      assert.ok(Math.abs(anchorOf(frame).y - target) / (PHONE.bottom - PHONE.top) < 0.03);
      assert.equal(frame.puck.kind, 'wedge');
      assert.equal(frame.easing, 'linear');
    }
    assert.ok(Math.max(...steady.map(f => f.zoom)) - Math.min(...steady.map(f => f.zoom)) < 0.01, `${mode} zoom steady`);
    // Lead: none walking; at most one interval (speed × 1 s) for bicycle/car.
    for (const frame of steady) assert.ok(frame.leadMeters <= (mode === 'walk' ? 0 : speed + 0.01));
  }
});

test('bearing across 359°→1° takes the short way and never orbits', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 600 }]);
  const courses = [350, 353, 356, 359, 1, 3, 6, 2, 358, 355];
  const frames = run(trajectory(fixture, { mode: 'car', speed: 10, seconds: courses.length, alignment: 'deviating', course: t => courses[t] }));
  for (let i = 1; i < frames.length; i += 1) assert.ok(Math.abs(angleDelta(frames[i - 1]!.bearing, frames[i]!.bearing)) < 8);
  for (const frame of frames) assert.ok(Math.abs(angleDelta(frame.bearing, 0)) <= 12, `bearing ${frame.bearing}`);
});

test('30 s stationary with noisy courses: no orbiting and no zoom pumping', () => {
  const fixture = routeFixture([{ bearing: 75, meters: 400 }]);
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  const inputs = trajectory(fixture, { mode: 'car', speed: 10, seconds: 36, speedAt: t => t < 6 ? 10 : 0.2 * noise(), course: (_, route) => _ < 6 ? route : noise() * 360 });
  // Stopped fixes jitter around one point.
  for (const input of inputs.slice(6)) Object.assign(input.fix!, offsetCoordinate(inputs[6]!.fix!, noise() * 360, noise() * 4));
  const frames = run(inputs).slice(7);
  assert.ok(frames.every(frame => Math.abs(angleDelta(frames[0]!.bearing, frame.bearing)) < 0.01), 'bearing held');
  assert.ok(Math.max(...frames.map(f => f.zoom)) - Math.min(...frames.map(f => f.zoom)) < 0.06, 'zoom held');
  assert.ok(frames.every(frame => frame.leadMeters === 0), 'no extrapolation while stopped');
});

for (const [mode, speed, window] of [['walk', 1.4, 8], ['bicycle', 5, 10], ['car', 10, 12]] as const) {
  test(`${mode}: turn framing starts ${window} s before the turn and shows the junction and outgoing path`, () => {
    const fixture = routeFixture([{ bearing: 0, meters: 400 }, { bearing: 90, meters: 300, modifier: 'right' }]);
    const inputs = trajectory(fixture, { mode, speed, seconds: Math.ceil(520 / speed) });
    const frames = run(inputs);
    const turn = offsetOfIndex(fixture.route, fixture.maneuvers[1]!.geometryIndex);
    const first = frames.findIndex(frame => frame.framing?.maneuverId === '1:1');
    assert.ok(first > 0);
    const secondsBefore = (turn - inputs[first]!.progress!.traveledMeters) / speed;
    assert.ok(secondsBefore <= window + 0.01 && secondsBefore > window - 1 - 0.01, `${mode} framing began ${secondsBefore.toFixed(1)} s before`);
    // Once the zoom has settled, the junction and outgoing path are inside the unobscured map.
    const framed = frames.slice(first + 2).filter(frame => frame.framing?.maneuverId === '1:1');
    assert.ok(framed.length > 0);
    for (const frame of framed) for (const point of frame.framing!.points) assert.ok(inside(project(frame, size, point), rect), `${mode} framed point outside`);
    // After the turn: the zoom returns to cruise over 2–3 s, not in one jump.
    const after = frames.findIndex((frame, i) => i > first && frame.framing === null);
    const cruise = frames[first - 1]!.zoom;
    const back = frames.findIndex((frame, i) => i >= after && Math.abs(frame.zoom - cruise) < 0.05);
    if (frames[after]!.zoom < cruise - 0.3) assert.ok(back - after >= 2 && back - after <= 4, `${mode} release ${back - after} s`);
  });
}

test('close turns: both junctions are framed', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 300 }, { bearing: 90, meters: 25, modifier: 'right' }, { bearing: 0, meters: 200, modifier: 'left' }]);
  const frames = run(trajectory(fixture, { mode: 'car', speed: 9, seconds: 32 }));
  const framed = frames.filter(frame => frame.framing?.maneuverId === '1:1');
  assert.ok(framed.length > 0);
  const second = maneuverPoint(fixture.maneuvers[2]!);
  for (const frame of framed.slice(2)) {
    assert.ok(frame.framing!.points.some(point => distanceMeters(point, second) < 1), 'second junction included');
    for (const point of frame.framing!.points) assert.ok(inside(project(frame, size, point), rect));
  }
});

test('roundabouts and U-turns are framed; arrival and straight continuations are not', () => {
  assert.ok(framesManeuver({ id: 'a', stepIndex: 1, geometryIndex: 1, type: 'roundabout', exit: 2, modifier: 'right', instruction: '' }));
  assert.ok(framesManeuver({ id: 'a', stepIndex: 1, geometryIndex: 1, type: 'continue', modifier: 'uturn', instruction: '' }));
  assert.ok(!framesManeuver({ id: 'a', stepIndex: 1, geometryIndex: 1, type: 'arrive', instruction: '' }));
  assert.ok(!framesManeuver({ id: 'a', stepIndex: 1, geometryIndex: 1, type: 'new name', modifier: 'straight', instruction: '' }));
});

test('U-turn: the presentation lead never passes the unconfirmed maneuver', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 200 }, { bearing: 180, meters: 200, type: 'continue', modifier: 'uturn' }]);
  const inputs = trajectory(fixture, { mode: 'car', speed: 12, seconds: 18 });
  const frames = run(inputs);
  const turn = offsetOfIndex(fixture.route, fixture.maneuvers[1]!.geometryIndex);
  frames.forEach((frame, i) => {
    const traveled = inputs[i]!.progress!.traveledMeters;
    if (traveled < turn) assert.ok(traveled + frame.leadMeters <= turn - 3 + 0.01 || frame.leadMeters === 0);
  });
});

test('deviation: cycling/driving leave the snapped line; walking always keeps its real offset', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 500 }]);
  const offRoute = run(trajectory(fixture, { mode: 'car', speed: 10, seconds: 4, lateralMeters: 12, alignment: 'deviating' }));
  const aligned = run(trajectory(fixture, { mode: 'car', speed: 10, seconds: 4, lateralMeters: 12 }));
  const walking = run(trajectory(fixture, { mode: 'walk', speed: 1.4, seconds: 4, lateralMeters: 6 }));
  const inputs = trajectory(fixture, { mode: 'car', speed: 10, seconds: 4, lateralMeters: 12 });
  assert.ok(distanceMeters(offRoute[3]!.puck.coordinate, inputs[3]!.fix!) < 0.01);
  assert.ok(distanceMeters(aligned[3]!.puck.coordinate, inputs[3]!.snapped!) < 0.01);
  const walkInputs = trajectory(fixture, { mode: 'walk', speed: 1.4, seconds: 4, lateralMeters: 6 });
  assert.ok(distanceMeters(walking[3]!.puck.coordinate, walkInputs[3]!.fix!) < 0.01);
});

test('degraded fixes stop extrapolation, hold the camera and show a retained puck', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 800 }]);
  const inputs = trajectory(fixture, { mode: 'car', speed: 12, seconds: 8 });
  const camera = new GuidanceCamera();
  const frames = inputs.slice(0, 5).map(input => camera.update(input)!);
  const live = frames[4]!;
  assert.ok(live.leadMeters > 0);
  // The same retained fix, now unusable: no camera move, puck subdued at the accepted position.
  const degraded = camera.update({ ...inputs[4]!, usable: false })!;
  assert.equal(degraded.key, live.key);
  assert.equal(degraded.puck.kind, 'retained');
  assert.ok(distanceMeters(degraded.puck.coordinate, inputs[4]!.fix!) < 0.01);
  // A late fix after the gap eases in without any lead.
  const late = camera.update({ ...inputs[7]!, fix: { ...inputs[7]!.fix!, elapsedMs: inputs[4]!.fix!.elapsedMs! + 9000 } })!;
  assert.equal(late.leadMeters, 0);
  assert.equal(late.easing, 'ease');
});

test('duplicate timestamps return the same frame; arrival is not framed', () => {
  const fixture = routeFixture([{ bearing: 0, meters: 120 }]);
  const inputs = trajectory(fixture, { mode: 'walk', speed: 1.4, seconds: 6, startOffset: 110 });
  const camera = new GuidanceCamera();
  const first = camera.update(inputs[0]!);
  assert.equal(camera.update({ ...inputs[0]!, fix: { ...inputs[0]!.fix!, latitude: inputs[0]!.fix!.latitude + 0.0001 } }), first);
  for (const input of inputs) assert.equal(camera.update(input)!.framing, null);
});

test('intent: a gesture enters free, overview and recenter are explicit; recenter is one ~500 ms move', () => {
  assert.equal(nextIntent('follow', 'gesture'), 'free');
  assert.equal(nextIntent('overview', 'gesture'), 'free');
  assert.equal(nextIntent('free', 'overview'), 'overview');
  assert.equal(nextIntent('free', 'recenter'), 'follow');
  const fixture = routeFixture([{ bearing: 0, meters: 300 }]);
  const camera = new GuidanceCamera();
  const frame = camera.update(trajectory(fixture, { mode: 'walk', speed: 1.4, seconds: 1 })[0]!)!;
  const recenter = camera.recenter()!;
  assert.notEqual(recenter.key, frame.key);
  assert.equal(recenter.durationMs, 500);
  assert.deepEqual([recenter.bearing, recenter.pitch, recenter.zoom], [frame.bearing, frame.pitch, frame.zoom]);
  const bounds = overviewBounds(fixture.route, 100, TURIN)!;
  assert.ok(bounds[0] < bounds[2] && bounds[1] < bounds[3]);
});

test('"Poi" appears only when the following maneuver is within about ten seconds of travel', () => {
  const near = { id: '1:2', stepIndex: 2, geometryIndex: 4, type: 'turn', instruction: '', afterUpcomingMeters: 25, afterUpcomingSeconds: 18 };
  assert.ok(followsClosely(near, 9), 'by distance at driving speed');
  assert.ok(!followsClosely({ ...near, afterUpcomingMeters: 400, afterUpcomingSeconds: 40 }, 9));
  assert.ok(followsClosely({ ...near, afterUpcomingMeters: 400, afterUpcomingSeconds: 8 }, 9), 'by route time');
  assert.ok(!followsClosely(undefined, 9));
});

test('providers without speed or course: kinematics are derived from consecutive fixes for presentation', () => {
  const fixture = routeFixture([{ bearing: 300, meters: 600 }]);
  const inputs = trajectory(fixture, { mode: 'car', speed: 10, seconds: 8, alignment: 'deviating' }).map(input => {
    const { speedMps: _speed, course: _course, courseAccuracyDegrees: _accuracy, ...fix } = input.fix!;
    return { ...input, fix };
  });
  const frames = run(inputs);
  assert.equal(frames[0]!.puck.kind, 'dot', 'no direction before a second fix');
  assert.ok(Math.abs(angleDelta(frames[7]!.bearing, 300)) < 1);
  assert.ok(frames[7]!.leadMeters > 5, 'derived speed allows the bounded lead');
});
