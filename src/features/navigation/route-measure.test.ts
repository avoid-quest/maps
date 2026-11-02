import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, bearingDegrees, distanceMeters, measureRoute, offsetCoordinate, offsetOfIndex, pointAt, routeBearingAt, segmentAt, sliceRoute } from './route-measure';
import { maneuverPoint, routeFixture, TURIN } from './guidance-fixtures';

test('route offsets use the native haversine metric on the bridged geometry', () => {
  const { route, maneuvers } = routeFixture([{ bearing: 0, meters: 200 }, { bearing: 90, meters: 150, modifier: 'right' }, { bearing: 0, meters: 100, modifier: 'left' }]);
  assert.ok(Math.abs(route.length - 450) < 0.5);
  assert.ok(Math.abs(offsetOfIndex(route, maneuvers[1]!.geometryIndex) - 200) < 0.5);
  assert.ok(Math.abs(offsetOfIndex(route, maneuvers[2]!.geometryIndex) - 350) < 0.5);
  assert.ok(distanceMeters(pointAt(route, 200), maneuverPoint(maneuvers[1]!)) < 0.01);
  assert.equal(segmentAt(route, -5), 0);
  assert.equal(segmentAt(route, 1e9), route.points.length - 2);
  const slice = sliceRoute(route, 190, 230);
  assert.ok(Math.abs(slice.slice(1).reduce((sum, point, i) => sum + distanceMeters(slice[i]!, point), 0) - 40) < 0.5, 'slice keeps the corner');
});

test('bearings wrap across north and the route bearing stops at the next maneuver', () => {
  assert.equal(angleDelta(359, 1), 2);
  assert.equal(angleDelta(1, 359), -2);
  assert.equal(angleDelta(10, 190), 180);
  assert.ok(Math.abs(bearingDegrees(TURIN, offsetCoordinate(TURIN, 359, 50)) - 359) < 0.05);
  const { route } = routeFixture([{ bearing: 0, meters: 200 }, { bearing: 90, meters: 150, modifier: 'right' }]);
  // 10 m before a right turn with a 30 m look-ahead limited to the turn: still north.
  assert.ok(Math.abs(angleDelta(routeBearingAt(route, 190, 30, 200)!, 0)) < 0.5);
  assert.ok(Math.abs(angleDelta(routeBearingAt(route, 190, 30)!, 0)) > 20, 'unlimited look-ahead cuts the corner');
  assert.equal(routeBearingAt(measureRoute([TURIN]), 0, 10), null);
});
