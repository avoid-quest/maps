import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStyleFor } from '../../theme/map-style';
import { BUILDING_EXTRUSION_LAYER, GUIDANCE_ROUTE_BEFORE, guidanceBasemap } from './guidance-basemap';

test('browsing and planning keep the basemap flat and complete', () => {
  for (const guidance of [null, undefined]) {
    assert.deepEqual(guidanceBasemap(guidance), { reduceBusinesses: false, oneWayArrows: false, buildings: false });
  }
});

test('first-person guidance shows supplied-height buildings in every camera mode', () => {
  assert.deepEqual(guidanceBasemap({ mode: 'walk' }), { reduceBusinesses: false, oneWayArrows: false, buildings: true });
  assert.deepEqual(guidanceBasemap({ mode: 'bicycle' }), { reduceBusinesses: true, oneWayArrows: false, buildings: true });
  assert.deepEqual(guidanceBasemap({ mode: 'car' }), { reduceBusinesses: true, oneWayArrows: true, buildings: true });
});

test('a transit ride framed without a walking camera stays flat', () => {
  assert.deepEqual(guidanceBasemap({ mode: null }), { reduceBusinesses: false, oneWayArrows: false, buildings: false });
});

test('the adopted layer and the route anchor exist in both basemaps, in drawing order', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const ids = mapStyleFor(scheme).layers.map(layer => layer.id);
    assert.ok(ids.includes(BUILDING_EXTRUSION_LAYER) && ids.includes(GUIDANCE_ROUTE_BEFORE));
    assert.ok(ids.indexOf(BUILDING_EXTRUSION_LAYER) < ids.indexOf(GUIDANCE_ROUTE_BEFORE), 'the route is drawn after the buildings');
  }
});
