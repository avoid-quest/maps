import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place, Stop } from '../../domain/types';
import { placeMarker, stopMarker, taskMarkers } from './map-layers';

const place: Place = { id: 'p', name: 'Caffè', coordinate: { latitude: 45.07, longitude: 7.68 }, source: 'Test', attributions: [] };
const other: Place = { ...place, id: 'q', name: 'Museo' };
const stop: Stop = { id: 's', code: 's', name: 'Porta Nuova', coordinate: { latitude: 45.06, longitude: 7.67 }, lines: [] };

test('list pins show only while nothing is selected', () => {
  const listed = [placeMarker(place), placeMarker(other)];
  assert.deepEqual(taskMarkers(listed, null, null).map(item => item.id), ['p', 'q']);
  assert.deepEqual(taskMarkers(listed, other, null), [placeMarker(other)]);
  assert.deepEqual(taskMarkers([], null, stop), [stopMarker(stop)]);
  assert.deepEqual(taskMarkers([], place, stop).map(item => item.kind), ['place', 'stop'], 'A journey stop keeps its destination pin');
  assert.deepEqual(stopMarker(stop).coordinate, [7.67, 45.06], 'Map coordinates are longitude first');
});
