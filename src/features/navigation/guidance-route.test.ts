import test from 'node:test';
import assert from 'node:assert/strict';
import { maneuverArrow, remainingGradient, traveledFraction } from './guidance-route';
import { routeFixture } from './guidance-fixtures';
import { angleDelta, bearingDegrees, distanceMeters } from './route-measure';

const fixture = routeFixture([{ bearing: 0, meters: 200 }, { bearing: 90, meters: 150, modifier: 'right' }, { bearing: 0, meters: 100, modifier: 'left' }]);

test('travelled fraction uses the native progress on the same geometry, clamped', () => {
  const at = (traveledMeters: number) => traveledFraction(fixture.route, { traveledMeters, routeLengthMeters: 450, segmentIndex: 0, stepIndex: 0 });
  assert.ok(Math.abs(at(225) - 0.5) < 0.002);
  assert.equal(at(-3), 0);
  assert.equal(at(9999), 1);
  assert.equal(traveledFraction(null, undefined), 0);
});

test('the remaining gradient is transparent before the cut and the route colour after it', () => {
  assert.deepEqual(remainingGradient('#000', 0), ['interpolate', ['linear'], ['line-progress'], 0, '#000', 1, '#000']);
  const cut = remainingGradient('#000', 0.25);
  assert.deepEqual(cut.slice(3), [0, 'rgba(0,0,0,0)', 0.25, 'rgba(0,0,0,0)', 0.250001, '#000', 1, '#000']);
  const stops = cut.slice(3).filter((_, i) => i % 2 === 0) as number[];
  assert.ok(stops.every((stop, i) => i === 0 || stop > stops[i - 1]!), 'stops strictly increase');
});

test('one arrow through the junction: real incoming and outgoing geometry, head along the exit', () => {
  const turn = fixture.maneuvers[1]!;
  for (const mode of ['walk', 'bicycle', 'car'] as const) {
    const arrow = maneuverArrow(fixture.route, turn, mode, 100)!;
    const corner = { latitude: turn.latitude!, longitude: turn.longitude! };
    assert.ok(arrow.shaft.some(([longitude, latitude]) => distanceMeters({ latitude, longitude }, corner) < 0.5), `${mode} passes the corner`);
    assert.ok(Math.abs(angleDelta(arrow.head.bearing, 90)) < 1, `${mode} head points along the exit`);
  }
  // Close to the turn the shaft never extends behind the current position.
  const near = maneuverArrow(fixture.route, turn, 'car', 195)!;
  const [lon, lat] = near.shaft[0]!;
  assert.ok(Math.abs(bearingDegrees({ latitude: lat, longitude: lon }, { latitude: turn.latitude!, longitude: turn.longitude! })) < 1, 'starts on the incoming leg');
  assert.ok(distanceMeters({ latitude: lat, longitude: lon }, { latitude: turn.latitude!, longitude: turn.longitude! }) < 5.5);
  assert.equal(maneuverArrow(fixture.route, fixture.maneuvers[3], 'car', 440), null, 'no arrow for arrival');
});
