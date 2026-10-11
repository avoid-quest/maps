import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../data/manifest.json';
import { getPlaceCoverage, PLACE_BOUNDS } from './place-coverage';

const center = { latitude: 45.095, longitude: 7.689 };

test('the extraction rectangle comes from package metadata, not a promised administrative boundary', () => {
  assert.deepEqual(PLACE_BOUNDS, manifest.places.bounds);
  assert.equal(getPlaceCoverage(center, 100).extent, 'contained');
  assert.equal(getPlaceCoverage(center).extent, 'partial');
  assert.equal(getPlaceCoverage(center).centerInside, true);
});

test('a search centered outside the rectangle can still overlap its edge', () => {
  const edge = getPlaceCoverage({ latitude: 45.095, longitude: 7.714 }, 2000);
  assert.equal(edge.centerInside, false);
  assert.equal(edge.extent, 'partial');
  const far = getPlaceCoverage({ latitude: 41.9028, longitude: 12.4964 });
  assert.equal(far.centerInside, false);
  assert.equal(far.extent, 'outside');
});

test('name matching explicitly searches the whole package even from a distant center', () => {
  const coverage = getPlaceCoverage({ latitude: 41.9028, longitude: 12.4964 }, null);
  assert.equal(coverage.extent, 'package');
  assert.equal(coverage.radiusMeters, null);
  assert.equal(coverage.centerInside, false);
});
