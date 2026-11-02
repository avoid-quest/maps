import test from 'node:test';
import assert from 'node:assert/strict';
import type { Stop } from '../domain/types';
import { searchMapStops, searchRows, searchRowCount, showsSearch } from '../features/search/search-rows';
import { endpointStops, isTransitQuery, searchTransit } from './transit-search';

const centre = { latitude: 45.0703, longitude: 7.6869 };

test('a typed stop code surfaces that stop, with or without the word fermata', () => {
  for (const query of ['472', 'fermata 472', 'Fermata 472']) {
    const result = searchTransit(query, centre);
    assert.equal(result.code?.code, '472', query);
    assert.equal(result.code?.name, 'Fermata 472 - CASTELLO');
  }
  const short = searchTransit('47', centre).code;
  assert.ok(!short || short.code === '47', 'codes match whole, never as a prefix');
  assert.equal(searchTransit('fermata 472', centre).explicit, true);
  assert.equal(searchTransit('linea 472', centre).code, null, 'a line query is not a stop code');
});

test('a line name offers that line’s nearest stops, nearest first', () => {
  for (const [query, name] of [['15', '15'], ['M1', 'M1'], ['m1', 'M1'], ['linea 4', '4']] as const) {
    const line = searchTransit(query, centre).line;
    assert.equal(line?.name, name, query);
    assert.ok(line!.stops.length > 0 && line!.stops.length <= 3);
    assert.ok(line!.stops.every((stop) => stop.lines.includes(name)));
  }
  assert.equal(searchTransit('Eataly', centre).line, null);
});

test('stop names match whole typed words; numbers never match inside names', () => {
  const named = searchTransit('lingotto', centre).named;
  assert.ok(named.length > 0 && named.every((stop) => /lingotto/i.test(stop.name)));
  assert.deepEqual(searchTransit('230', centre).named, []);
  assert.deepEqual(searchTransit('li', centre).named, []);
});

const stop = (id: string, code: string, lines: string[] = ['15']): Stop => ({ id, code, name: `Fermata ${code} - PROVA`, coordinate: centre, lines });
const place = { id: 'p', name: 'Luogo', coordinate: centre, source: 'Fixture', attributions: [] };

test('rows lead with a typed code and line, then places; named stops follow unless asked for', () => {
  const code = stop('a', '472');
  const rows = searchRows([place], { code, line: { name: '15', stops: [stop('b', '471')] }, named: [stop('c', '9')], explicit: false });
  assert.deepEqual(rows.map((row) => row.kind === 'section' ? `#${row.title}` : row.kind), ['#Fermata', 'stop', '#Linea 15 · fermate vicine', 'stop', '#Luoghi e indirizzi', 'place', '#Fermate', 'stop']);
  assert.equal(searchRowCount(rows), 4);
  const asked = searchRows([place], { code: null, line: null, named: [stop('c', '9')], explicit: true });
  assert.deepEqual(asked.map((row) => row.kind === 'section' ? `#${row.title}` : row.kind), ['#Fermate', 'stop', '#Luoghi e indirizzi', 'place']);
  assert.deepEqual(searchRows([place], { code: null, line: null, named: [], explicit: false }).map((row) => row.kind), ['place'], 'one kind needs no heading');
});

test('one-character stop codes and lines open results; other single characters do not', () => {
  const four = searchTransit('4', centre);
  assert.ok(four.line, 'line 4 exists');
  assert.equal(showsSearch('4', four), true);
  assert.equal(showsSearch('x', searchTransit('x', centre)), false);
  assert.equal(showsSearch('ba', searchTransit('ba', centre)), true);
});

test('endpoint editors offer a line’s nearest stops, deduplicated with code and name matches', () => {
  for (const query of ['M1', 'linea 4']) {
    const stops = endpointStops(searchTransit(query, centre));
    assert.ok(stops.length > 0 && stops.length <= 3, query);
  }
  const a = stop('a', '1'); const b = stop('b', '2');
  assert.deepEqual(endpointStops({ code: a, line: { name: '15', stops: [a, b] }, named: [b], explicit: false }).map((item) => item.id), ['a', 'b']);
});

test('every recognised transit prefix and code-shaped token is a device-only query', () => {
  for (const query of ['472', 'fermata 472', 'stop 472', 'bus 15', 'tram 4', 'metro M1', 'linea 4', 'M1', '10N', 'Fermate Castello']) assert.equal(isTransitQuery(query), true, query);
  for (const query of ['Eataly', 'via nizza 230', 'porta nuova', 'bar 24']) assert.equal(isTransitQuery(query), false, query);
});

test('the map pins every listed stop and frames name matches when they lead or nothing else matched', () => {
  const a = stop('a', '1'); const b = stop('b', '2');
  assert.deepEqual(searchMapStops({ code: null, line: null, named: [a, b], explicit: true }, 5), { pinned: [a, b], framed: [a, b] });
  assert.deepEqual(searchMapStops({ code: null, line: null, named: [a], explicit: false }, 0), { pinned: [a], framed: [a] });
  assert.deepEqual(searchMapStops({ code: null, line: null, named: [a], explicit: false }, 3), { pinned: [a], framed: [] }, 'places lead, so they are framed');
  assert.deepEqual(searchMapStops({ code: a, line: { name: '15', stops: [a, b] }, named: [], explicit: false }, 3), { pinned: [a, b], framed: [a, b] });
  const castello = searchTransit('fermata castello', centre);
  assert.ok(castello.named.length > 0);
  assert.equal(searchMapStops(castello, 0).framed.length, castello.named.length);
});
