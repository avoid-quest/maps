import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEstimator } from './motion-estimator';
import { offsetCoordinate } from './route-measure';
import { TURIN } from './guidance-fixtures';

test('stationary jitter (2 m east/west at ±5 m) never becomes motion, speed or course', () => {
  const estimator = new MotionEstimator();
  for (let t = 0; t < 60; t += 1) {
    const motion = estimator.update(offsetCoordinate(TURIN, t % 2 ? 90 : 270, 2), 1000 * t, 5);
    assert.deepEqual(motion, { speedMps: 0, moving: false }, `t=${t}`);
  }
});

test('jitter larger than the reported accuracy flips direction and never passes the consistency hysteresis', () => {
  const estimator = new MotionEstimator();
  for (let t = 0; t < 40; t += 1) assert.equal(estimator.update(offsetCoordinate(TURIN, t % 2 ? 90 : 270, 4), 1000 * t, 3).moving, false);
});

test('driving at 10 m/s: motion after two consistent estimates, honest course accuracy', () => {
  const estimator = new MotionEstimator();
  const results = Array.from({ length: 8 }, (_, t) => estimator.update(offsetCoordinate(TURIN, 300, 10 * t), 1000 * t, 5));
  assert.equal(results[1]!.moving, false, 'one estimate is not enough');
  assert.equal(results[2]!.moving, true);
  for (const motion of results.slice(3)) {
    assert.ok(Math.abs(motion.speedMps - 10) < 0.2);
    assert.ok(Math.abs(motion.course! - 300) < 0.5);
    assert.ok(motion.courseAccuracyDegrees! <= 27, `${motion.courseAccuracyDegrees}`);
  }
});

test('walking at 1.4 m/s with ±5 m fixes waits for a baseline above the noise; ±25 m fixes stay unproven', () => {
  const precise = new MotionEstimator();
  const walk = Array.from({ length: 12 }, (_, t) => precise.update(offsetCoordinate(TURIN, 45, 1.4 * t), 1000 * t, 5));
  assert.equal(walk[4]!.moving, false, '5.6 m < 7.1 m combined accuracy');
  assert.equal(walk[11]!.moving, true);
  assert.ok(Math.abs(walk[11]!.speedMps - 1.4) < 0.1);
  const coarse = new MotionEstimator();
  for (let t = 0; t < 20; t += 1) assert.equal(coarse.update(offsetCoordinate(TURIN, 45, 1.4 * t), 1000 * t, 25).moving, false);
});

test('stopping returns to stationary at once; duplicate sample times are ignored', () => {
  const estimator = new MotionEstimator();
  for (let t = 0; t < 5; t += 1) estimator.update(offsetCoordinate(TURIN, 0, 10 * t), 1000 * t, 5);
  assert.equal(estimator.current.moving, true);
  assert.equal(estimator.update(offsetCoordinate(TURIN, 0, 99), 4000, 5).moving, true, 'same time: unchanged');
  for (let t = 5; t < 16; t += 1) estimator.update(offsetCoordinate(TURIN, 0, 40), 1000 * t, 5);
  assert.deepEqual(estimator.current, { speedMps: 0, moving: false });
});
