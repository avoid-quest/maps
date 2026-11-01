import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteFraming, mapCameraPadding } from './map-presentation';

test('refreshes and late responses respect manual map browsing; an explicit frame still works', () => {
  const camera = createRouteFraming();
  assert.equal(camera.claim('route-a', false), false);
  camera.userMoved('route-a');
  assert.equal(camera.claim('route-a', true), false, 'late route must not undo the pan');
  assert.equal(camera.claim('route-a:frame-1', true), true);
  assert.equal(camera.claim('route-a:frame-1', true), false, 'refresh updates the line without reframing');
  assert.equal(camera.claim('route-b', true), true, 'explicit alternative is framed');
  assert.equal(camera.claim(undefined, false), false);
  assert.equal(camera.claim('route-a', true), true, 'opening a new planning flow can frame again');
});

test('side sheets, expanded sheets, short windows and navigation leave a usable camera viewport', () => {
  for (const [width, height, sheetHeight] of [[1280, 800, 712], [393, 852, 708], [320, 568, 424], [393, 852, 280], [740, 360, 216]]) {
    for (const navigating of [false, true]) {
      const padding = mapCameraPadding({ width: width!, height: height!, sheetHeight: sheetHeight!, panelVisible: true, navigating, fontScale: 1.5 });
      assert.ok(height! - padding.top - padding.bottom >= 120);
      assert.ok(width! - padding.left - padding.right >= 120);
      if (width! >= 850 && !navigating) assert.equal(padding.bottom, 96);
    }
  }
});

test('a submitted search frames its leading nearby results, never the whole country', async () => {
  const { resultFrameBounds } = await import('./map-presentation');
  const turin = { latitude: 45.07, longitude: 7.68 };
  const mole = { latitude: 45.069, longitude: 7.6933 };
  const castello = { latitude: 45.0712, longitude: 7.6854 };
  const rome = { latitude: 41.9, longitude: 12.5 };
  const bounds = resultFrameBounds([castello, rome, mole], turin)!;
  assert.ok(bounds[0] <= mole.longitude && bounds[2] >= mole.longitude && bounds[1] <= mole.latitude && bounds[3] >= mole.latitude, 'a result ~650 m away is inside the frame');
  assert.ok(bounds[2] < 8, 'a far online match does not widen the frame');
  const single = resultFrameBounds([mole], turin)!;
  assert.ok(single[2] - single[0] >= 0.0039 && single[3] - single[1] >= 0.0039, 'one result is framed as a street area, not a point');
  assert.deepEqual(resultFrameBounds([rome], turin)!.map(value => Math.round(value)), [12, 42, 13, 42], 'only far results: frame the first one');
  assert.equal(resultFrameBounds([], turin), null);
});
