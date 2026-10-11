import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteLeg, Stop } from '../domain/types';
import {
  createSavedTravel, JOURNEY_STORAGE_KEY, STOPS_STORAGE_KEY, MAX_JOURNEY_BYTES, MAX_STOPS_BYTES, MAX_SAVED_STOPS,
  type SavedJourneyInput,
} from './saved-travel';

const fetchedAt = Date.parse('2026-10-11T12:00:00Z');
const savedAt = fetchedAt + 90_000;
const departureAt = Date.parse('2026-10-12T07:00:00Z');
const from = { latitude: 45.07545, longitude: 7.63915 };
const to = { latitude: 45.09606, longitude: 7.65752 };
const stopA: Stop = { id: '6', code: '10', name: 'RUBIANA', coordinate: from, lines: ['36', 'W01'] };
const stopB: Stop = { id: '7', code: '100', name: 'TOSCANA', coordinate: to, lines: ['2'] };
const installed = new Map([stopA, stopB].map(stop => [stop.id, stop]));
const options = { now: () => savedAt, getStop: (id: string) => installed.get(id), datasetVersion: '20261011' };

function journey(id = 'selected-alternative'): SavedJourneyInput {
  const statuses = ['prediction', 'cancelled', 'unknown', 'scheduled'] as const;
  const legs: RouteLeg[] = statuses.map((timingStatus, index) => ({
    id: `leg-${index}`, mode: 'bus', line: '36', headsign: 'Direzione pubblica',
    from: stopA.name, to: stopB.name,
    fromStop: { id: 'mato:gtt:10', code: '10', name: stopA.name, coordinate: from, platformCode: '2' },
    toStop: { id: 'mato:gtt:100', code: '100', name: stopB.name, coordinate: to },
    tripId: `mato:trip-${index}`, serviceDate: '20261012',
    transitLeg: true, interlineWithPreviousLeg: false, timingStatus, realTime: timingStatus === 'prediction',
    durationSeconds: 600, distanceMeters: 1000, departureAt: departureAt + index * 600_000, arrivalAt: departureAt + (index + 1) * 600_000,
    geometry: [from, to], steps: [],
  }));
  return {
    query: { from, to, mode: 'transit', transitTime: { kind: 'now' } }, originLabel: 'Punto sulla mappa', destinationLabel: 'Fermata pubblica',
    plan: {
      id, mode: 'transit', distanceMeters: 4000, durationSeconds: 2400, departureAt, arrivalAt: departureAt + 2400_000,
      walkingDurationSeconds: 0, walkingDistanceMeters: 0, waitingDurationSeconds: 0, transferCount: 3,
      geometry: [from, to], legs, source: 'MATO / 5T', warnings: ['Corsa cancellata; verifica prima di viaggiare.'], fetchedAt,
    },
  };
}
function roadJourney(): SavedJourneyInput {
  const input = journey('walking-preview');
  input.query.mode = 'walk';
  input.plan = {
    id: 'walking-preview', mode: 'walk', distanceMeters: 600, durationSeconds: 500,
    walkingDurationSeconds: 500, walkingDistanceMeters: 600, waitingDurationSeconds: 0, transferCount: 0,
    geometry: [from, to], fetchedAt, source: 'FOSSGIS / OpenStreetMap', warnings: ['Anteprima senza guida vocale.'],
    legs: [{
      id: 'walking-leg', mode: 'walk', from: 'Partenza', to: 'Destinazione', transitLeg: false, interlineWithPreviousLeg: false,
      timingStatus: 'unknown', realTime: false, durationSeconds: 500, distanceMeters: 600, geometry: [from, to],
      steps: [{ instruction: 'Prosegui dritto', distanceMeters: 600, coordinate: from }],
    }],
  };
  return input;
}
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const calls: { method: 'get' | 'set' | 'remove'; key: string }[] = [];
  return {
    values, calls,
    getItem: async (key: string) => { calls.push({ method: 'get', key }); return values.get(key) ?? null; },
    setItem: async (key: string, value: string) => { calls.push({ method: 'set', key }); values.set(key, value); },
    removeItem: async (key: string) => { calls.push({ method: 'remove', key }); values.delete(key); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const journeyBytes = (input = journey()) => JSON.stringify({ version: 1, journey: { ...input, savedAt } });
const stopBytes = () => JSON.stringify({ version: 1, stops: [{ id: stopA.id, code: stopA.code, name: stopA.name, coordinate: stopA.coordinate, datasetVersion: '20261011' }] });

test('one explicit selected plan round-trips query, original age and all timing states', async () => {
  const disk = memory(); const store = createSavedTravel(options);
  await store.initialize(disk);
  assert.equal(disk.calls.filter(call => call.method !== 'get').length, 0);
  const input = journey();
  assert.equal(await store.saveJourney(input), true);
  const first = store.getSnapshot().journey!;
  assert.equal(first.savedAt, savedAt);
  assert.equal(first.plan.fetchedAt, fetchedAt);
  assert.deepEqual(first.query, input.query);
  assert.deepEqual(first.plan.legs.map(leg => leg.timingStatus), ['prediction', 'cancelled', 'unknown', 'scheduled']);
  assert.deepEqual(first.plan.legs.map(leg => leg.realTime), [true, false, false, false]);
  const restored = createSavedTravel({ ...options, now: () => savedAt + 86_400_000 });
  await restored.initialize(disk);
  assert.deepEqual(restored.getSnapshot().journey, first);
  assert.equal(restored.getSnapshot().journeyStatus, 'ready');
  assert.equal(restored.getSnapshot().journeyFailure, null);
  assert.equal(disk.calls.filter(call => call.method === 'set').length, 1, 'Restore must not rewrite timestamps');
  assert.equal(await restored.saveJourney(journey('replacement')), true);
  assert.equal(restored.getSnapshot().journey?.plan.id, 'replacement');
  assert.equal(await restored.clearJourney(), true);
  assert.equal(disk.values.has(JOURNEY_STORAGE_KEY), false);
  assert.equal(restored.getSnapshot().journey, null);
  const empty = createSavedTravel(options); await empty.initialize(disk);
  assert.equal(empty.getSnapshot().journey, null);
});

test('road plans and fixed Rome departure/arrival queries survive without inventing fields', async () => {
  const departing = journey(); departing.query.transitTime = { kind: 'depart-at', date: '2026-10-12', time: '08:30' };
  const arriving = journey(); arriving.query.transitTime = { kind: 'arrive-by', date: '2026-10-12', time: '09:30:00' };
  for (const input of [roadJourney(), departing, arriving]) {
    const disk = memory(); const store = createSavedTravel(options); await store.initialize(disk);
    assert.equal(await store.saveJourney(input), true);
    const restored = createSavedTravel(options); await restored.initialize(disk);
    assert.deepEqual(restored.getSnapshot().journey?.query, input.query);
    assert.equal(restored.getSnapshot().journey?.plan.departureAt, input.plan.departureAt);
    assert.equal(restored.getSnapshot().journey?.plan.legs[0]?.steps.length, input.plan.legs[0]!.steps.length);
  }
});

test('allowlists discard nested extra fields and queued save captures an independent immutable input', async () => {
  const disk = memory(); const store = createSavedTravel(options); await store.initialize(disk);
  const input = roadJourney();
  Object.assign(input, { unwanted: 'discard-me' });
  Object.assign(input.query, { unwanted: 'discard-me' });
  Object.assign(input.plan, { unwanted: 'discard-me' });
  Object.assign(input.plan.legs[0]!, { unwanted: 'discard-me' });
  Object.assign(input.plan.legs[0]!.steps[0]!, { unwanted: 'discard-me' });
  const saved = store.saveJourney(input);
  input.destinationLabel = 'Changed after click'; input.plan.geometry = [];
  assert.equal(await saved, true);
  assert.equal(store.getSnapshot().journey?.destinationLabel, 'Fermata pubblica');
  assert.equal(store.getSnapshot().journey?.plan.geometry.length, 2);
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY)!.includes('discard-me'), false);
  assert.ok(Object.isFrozen(store.getSnapshot().journey?.plan.legs[0]));
  const raw = JSON.parse(disk.values.get(JOURNEY_STORAGE_KEY)!);
  raw.journey.plan.legs[0].steps[0].unwanted = 'discard-me';
  disk.values.set(JOURNEY_STORAGE_KEY, JSON.stringify(raw));
  const restored = createSavedTravel(options); await restored.initialize(disk);
  assert.equal(JSON.stringify(restored.getSnapshot()).includes('discard-me'), false);
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY)!.includes('discard-me'), true, 'Reading must not silently rewrite stored bytes');
});

test('malformed nested schema and inconsistent plans never replace the last saved journey', async () => {
  const corruptions: ((input: SavedJourneyInput) => void)[] = [
    value => { value.query.from = { latitude: NaN, longitude: 7 }; },
    value => { value.query.to.longitude = 181; },
    value => { value.query.mode = 'walk'; },
    value => { value.query.transitTime = { kind: 'depart-at', date: '2026-02-30', time: '08:30' }; },
    value => { value.query.transitTime = { kind: 'depart-at', date: '2026-03-29', time: '02:30' }; },
    value => { value.originLabel = ''; },
    value => { value.plan.fetchedAt = Infinity; },
    value => { value.plan.durationSeconds = -1; },
    value => { value.plan.legs[0]!.realTime = false; },
    value => { value.plan.legs[0]!.arrivalAt = departureAt - 1; },
    value => { value.plan.legs[0]!.durationSeconds = 999; },
    value => { value.plan.legs[0]!.serviceDate = '20260230'; },
    value => { value.plan.legs[0]!.fromStop!.coordinate = { latitude: 91, longitude: 7 }; },
    value => { value.plan.legs[1]!.id = value.plan.legs[0]!.id; },
    value => { value.plan.legs[0]!.interlineWithPreviousLeg = true; },
    value => { value.plan.transferCount = 3.5; },
    value => { value.plan.transferCount = 0; },
    value => { value.plan.legs = []; },
    value => { value.plan.geometry = [null as unknown as typeof from]; },
    value => { value.plan.walkingDurationSeconds = 100_000; },
    value => { value.plan.source = undefined as unknown as string; },
  ];
  for (const corrupt of corruptions) {
    const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes() });
    const original = disk.values.get(JOURNEY_STORAGE_KEY);
    const store = createSavedTravel(options); await store.initialize(disk);
    const input = structuredClone(journey('invalid-replacement')); corrupt(input);
    assert.equal(await store.saveJourney(input), false);
    assert.equal(store.getSnapshot().journeyFailure, 'invalid-data');
    assert.equal(store.getSnapshot().journey?.plan.id, 'selected-alternative');
    assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), original);
  }
});

test('byte bounds include UTF-8 and collection limits without truncating the existing snapshot', async () => {
  const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes() });
  const store = createSavedTravel(options); await store.initialize(disk);
  const large = journey('🚌'.repeat(131_000));
  const raw = journeyBytes(large);
  assert.ok(raw.length < MAX_JOURNEY_BYTES);
  assert.ok(Buffer.byteLength(raw, 'utf8') > MAX_JOURNEY_BYTES);
  assert.equal(await store.saveJourney(large), false);
  assert.equal(store.getSnapshot().journeyFailure, 'too-large');
  const excessive = journey(); excessive.plan.geometry = Array.from({ length: 20_001 }, () => from);
  assert.equal(await store.saveJourney(excessive), false);
  assert.equal(store.getSnapshot().journeyFailure, 'too-large');
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), journeyBytes());
});

test('corrupt or unsupported journey bytes remain untouched while valid stops still load', async () => {
  for (const raw of ['', '{', '{}', '{"version":2,"journey":{}}', '{"version":1,"journey":null}', 'x'.repeat(MAX_JOURNEY_BYTES + 1)]) {
    const disk = memory({ [JOURNEY_STORAGE_KEY]: raw, [STOPS_STORAGE_KEY]: stopBytes() });
    const store = createSavedTravel(options); await store.initialize(disk);
    assert.equal(store.getSnapshot().journeyStatus, 'unavailable');
    assert.equal(store.getSnapshot().stopsStatus, 'ready');
    assert.equal(store.getSnapshot().stops[0]?.current?.id, stopA.id);
    assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), raw);
    assert.equal(disk.calls.filter(call => call.method !== 'get').length, 0);
    assert.equal(await store.saveJourney(journey()), true, 'An explicit replacement may repair the journey');
    assert.equal(store.getSnapshot().journeyStatus, 'ready');
  }
});

test('failed reads keep independent outcomes and do not overwrite unreadable bytes', async () => {
  const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes(), [STOPS_STORAGE_KEY]: stopBytes() });
  const store = createSavedTravel(options);
  await store.initialize({ ...disk, getItem: async key => {
    if (key === JOURNEY_STORAGE_KEY) throw new Error('private storage error');
    return disk.getItem(key);
  } });
  assert.equal(store.getSnapshot().journeyFailure, 'storage-unavailable');
  assert.equal(store.getSnapshot().stopsStatus, 'ready');
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), journeyBytes());
  assert.equal(JSON.stringify(store.getSnapshot()).includes('private storage error'), false);
  assert.equal(await store.clearJourney(), true);
  assert.equal(store.getSnapshot().journeyStatus, 'ready');
  assert.equal(store.getSnapshot().journeyFailure, null);
  assert.equal(disk.values.has(JOURNEY_STORAGE_KEY), false);
});

test('failed save and failed removal preserve committed values and report no success', async () => {
  const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes(), [STOPS_STORAGE_KEY]: stopBytes() });
  const store = createSavedTravel(options);
  await store.initialize({ ...disk, setItem: async () => { throw new Error('full'); }, removeItem: async () => { throw new Error('unavailable'); } });
  assert.equal(await store.saveJourney(journey('replacement')), false);
  assert.equal(await store.clearJourney(), false);
  assert.equal(store.getSnapshot().journey?.plan.id, 'selected-alternative');
  assert.equal(store.getSnapshot().journeyFailure, 'storage-unavailable');
  assert.equal(await store.saveStop(stopB.id), false);
  assert.equal(await store.removeStop(stopA.id), false);
  assert.equal(await store.clearStops(), false);
  assert.deepEqual(store.getSnapshot().stops.map(item => item.saved.id), [stopA.id]);
  assert.equal(store.getSnapshot().stopsFailure, 'storage-unavailable');
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), journeyBytes());
  assert.equal(disk.values.get(STOPS_STORAGE_KEY), stopBytes());
});

test('clear wins delayed initialization for both keys without waiting for the reads', async () => {
  const originalJourney = journeyBytes(); const originalStops = stopBytes();
  const disk = memory({ [JOURNEY_STORAGE_KEY]: originalJourney, [STOPS_STORAGE_KEY]: originalStops });
  const journeyRead = deferred<string | null>(); const stopsRead = deferred<string | null>();
  const store = createSavedTravel(options);
  const initialized = store.initialize({ ...disk, getItem: key => key === JOURNEY_STORAGE_KEY ? journeyRead.promise : stopsRead.promise });
  assert.equal(await store.clearJourney(), true);
  assert.equal(await store.clearStops(), true);
  journeyRead.resolve(originalJourney); stopsRead.resolve(originalStops);
  await initialized;
  assert.equal(store.getSnapshot().journey, null);
  assert.deepEqual(store.getSnapshot().stops, []);
  assert.equal(store.getSnapshot().journeyStatus, 'ready');
  assert.equal(store.getSnapshot().stopsStatus, 'ready');
  assert.equal(disk.values.size, 0);
});

test('explicit replacement wins delayed initialization; failed replacement still recovers the original read', async () => {
  for (const fail of [false, true]) {
    const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes() }); const reading = deferred<string | null>();
    const store = createSavedTravel(options);
    const initialized = store.initialize({ ...disk,
      getItem: key => key === JOURNEY_STORAGE_KEY ? reading.promise : disk.getItem(key),
      setItem: async (key, value) => { if (fail) throw new Error('full'); await disk.setItem(key, value); },
    });
    assert.equal(await store.saveJourney(journey('new')), !fail);
    reading.resolve(journeyBytes()); await initialized;
    assert.equal(store.getSnapshot().journey?.plan.id, fail ? 'selected-alternative' : 'new');
    assert.equal(store.getSnapshot().journeyFailure, fail ? 'storage-unavailable' : null);
  }
});

test('serialized older writes cannot resurrect a cleared journey, while a later explicit save may', async () => {
  const disk = memory(); const writing = deferred<void>(); const started = deferred<void>();
  const store = createSavedTravel(options);
  let delayed = true;
  await store.initialize({ ...disk, setItem: async (key, value) => {
    if (delayed) { delayed = false; started.resolve(); await writing.promise; }
    await disk.setItem(key, value);
  } });
  const oldSave = store.saveJourney(journey('old')); await started.promise;
  const cleared = store.clearJourney();
  const seen: (string | undefined)[] = [];
  store.subscribe(() => seen.push(store.getSnapshot().journey?.plan.id));
  assert.equal(disk.calls.filter(call => call.method === 'remove').length, 0, 'Removal must follow the older write');
  writing.resolve(); assert.equal(await oldSave, true); assert.equal(await cleared, true);
  assert.equal(disk.values.has(JOURNEY_STORAGE_KEY), false);
  assert.equal(store.getSnapshot().journey, null);
  assert.ok(!seen.includes('old'));
  assert.equal(await store.saveJourney(journey('deliberate-later-save')), true);
  assert.equal(store.getSnapshot().journey?.plan.id, 'deliberate-later-save');
});

test('a notification from the other key cannot expose an old read while removal is pending', async () => {
  const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes() });
  const reading = deferred<string | null>(); const removing = deferred<void>(); const removalStarted = deferred<void>();
  const store = createSavedTravel(options);
  const initialized = store.initialize({ ...disk,
    getItem: key => key === JOURNEY_STORAGE_KEY ? reading.promise : disk.getItem(key),
    removeItem: async key => { removalStarted.resolve(); await removing.promise; await disk.removeItem(key); },
  });
  const cleared = store.clearJourney(); await removalStarted.promise;
  reading.resolve(journeyBytes()); await initialized;
  assert.equal(await store.saveStop(stopA.id), true, 'The other key remains independently writable');
  assert.equal(store.getSnapshot().journey, null, 'An unrelated notification must not reveal the obsolete read');
  removing.resolve(); assert.equal(await cleared, true);
  assert.equal(store.getSnapshot().journey, null);
});

test('a failed removal after a late read shows the retained record and an honest error', async () => {
  const disk = memory({ [JOURNEY_STORAGE_KEY]: journeyBytes() });
  const reading = deferred<string | null>(); const removing = deferred<void>();
  const store = createSavedTravel(options);
  const initialized = store.initialize({ ...disk,
    getItem: key => key === JOURNEY_STORAGE_KEY ? reading.promise : disk.getItem(key),
    removeItem: async () => { await removing.promise; throw new Error('failed removal'); },
  });
  const cleared = store.clearJourney();
  reading.resolve(journeyBytes()); await initialized;
  removing.resolve(); assert.equal(await cleared, false);
  assert.equal(store.getSnapshot().journey?.plan.id, 'selected-alternative');
  assert.equal(store.getSnapshot().journeyFailure, 'storage-unavailable');
  assert.equal(disk.values.get(JOURNEY_STORAGE_KEY), journeyBytes());
});

test('a queued failure retains the last committed earlier write and queues remain usable', async () => {
  const disk = memory(); let attempts = 0; const store = createSavedTravel(options);
  await store.initialize({ ...disk, setItem: async (key, value) => {
    if (++attempts === 2) throw new Error('full');
    await disk.setItem(key, value);
  } });
  const first = store.saveJourney(journey('first')); const second = store.saveJourney(journey('second'));
  assert.equal(await first, true); assert.equal(await second, false);
  assert.equal(store.getSnapshot().journey?.plan.id, 'first');
  assert.equal(store.getSnapshot().journeyFailure, 'storage-unavailable');
  assert.equal(await store.saveJourney(journey('third')), true);
  assert.equal(store.getSnapshot().journey?.plan.id, 'third');
  assert.equal(store.getSnapshot().journeyFailure, null);
});

test('saved stops use exact installed ID/code/coordinates; missing or changed identities remain removable', async () => {
  const disk = memory(); const store = createSavedTravel(options); await store.initialize(disk);
  assert.equal(await store.saveStop(stopA.id), true);
  assert.equal(await store.saveStop(stopB.id), true);
  assert.equal(await store.saveStop(stopA.id), true);
  assert.deepEqual(store.getSnapshot().stops.map(item => item.saved.id), [stopA.id, stopB.id]);
  assert.equal(await store.saveStop(stopA.code), false, 'A public code must not be substituted for an installed ID');
  assert.equal(store.getSnapshot().stopsFailure, 'stop-unavailable');
  const variants: (Stop | undefined)[] = [undefined, { ...stopA, id: 'other' }, { ...stopA, code: '999' }, { ...stopA, coordinate: { ...from, longitude: from.longitude + 0.00001 } }];
  for (const variant of variants) {
    const sampleDisk = memory(Object.fromEntries(disk.values));
    const restored = createSavedTravel({ ...options, getStop: id => id === stopA.id ? variant : installed.get(id), datasetVersion: '20261012' });
    await restored.initialize(sampleDisk);
    assert.equal(restored.getSnapshot().stops[0]!.current, null);
    assert.equal(restored.getSnapshot().stops[1]!.current?.id, stopB.id);
    assert.equal(await restored.removeStop(stopA.id), true);
    assert.deepEqual(restored.getSnapshot().stops.map(item => item.saved.id), [stopB.id]);
  }
  const upgraded = createSavedTravel({ ...options, datasetVersion: '20261012' }); await upgraded.initialize(disk);
  assert.equal(upgraded.getSnapshot().stops[0]!.current?.id, stopA.id, 'An unchanged stop remains usable in a newer package');
  assert.equal(upgraded.getSnapshot().stops[0]!.saved.datasetVersion, '20261011');
});

test('corrupt stop data cannot be silently discarded by adding or removing one stop', async () => {
  for (const raw of ['', '{', '{"version":2,"stops":[]}', '{"version":1,"stops":[{}]}', 'x'.repeat(MAX_STOPS_BYTES + 1)]) {
    const disk = memory({ [STOPS_STORAGE_KEY]: raw, [JOURNEY_STORAGE_KEY]: journeyBytes() });
    const store = createSavedTravel(options); await store.initialize(disk);
    assert.equal(store.getSnapshot().stopsStatus, 'unavailable');
    assert.equal(store.getSnapshot().journeyStatus, 'ready');
    assert.equal(await store.saveStop(stopA.id), false);
    assert.equal(await store.removeStop(stopA.id), false);
    assert.equal(disk.values.get(STOPS_STORAGE_KEY), raw);
    assert.equal(await store.clearStops(), true);
    assert.equal(await store.saveStop(stopA.id), true);
    assert.equal(store.getSnapshot().stops.length, 1);
  }
});

test('stop storage is bounded and queued additions/removals do not lose each other', async () => {
  const disk = memory();
  const getStop = (id: string): Stop => ({ ...stopA, id, code: id });
  const store = createSavedTravel({ ...options, getStop }); await store.initialize(disk);
  const saved = Array.from({ length: MAX_SAVED_STOPS }, (_, index) => store.saveStop(String(index)));
  assert.ok((await Promise.all(saved)).every(Boolean));
  assert.equal(store.getSnapshot().stops.length, MAX_SAVED_STOPS);
  assert.equal(await store.saveStop('extra'), false);
  assert.equal(store.getSnapshot().stopsFailure, 'limit-reached');
  assert.equal(await store.saveStop('0'), true, 'Replacing an existing stop does not consume another slot');
  const remove = store.removeStop('0'); const add = store.saveStop('extra');
  assert.equal(await remove, true); assert.equal(await add, true);
  assert.equal(store.getSnapshot().stops.length, MAX_SAVED_STOPS);
  assert.equal(store.getSnapshot().stops[0]!.saved.id, 'extra');
  assert.ok(Buffer.byteLength(disk.values.get(STOPS_STORAGE_KEY)!, 'utf8') <= MAX_STOPS_BYTES);
});

test('stable subscriptions, idempotent initialization and observers cannot break persistence', async () => {
  const disk = memory(); const store = createSavedTravel(options);
  const getSnapshot = store.getSnapshot; const subscribe = store.subscribe;
  assert.equal(getSnapshot(), getSnapshot());
  assert.equal(await store.saveJourney(journey()), false);
  assert.equal(getSnapshot().journeyFailure, 'not-ready');
  const first = store.initialize(disk); const second = store.initialize({
    getItem: async () => { throw new Error('Must not initialize a different store'); },
    setItem: disk.setItem, removeItem: disk.removeItem,
  });
  assert.equal(first, second); await first;
  assert.equal(disk.calls.filter(call => call.method === 'get').length, 2);
  assert.equal(getSnapshot(), getSnapshot());
  let observed = 0;
  const unsubscribe = subscribe(() => { observed++; throw new Error('Observer failure'); });
  assert.equal(await store.saveJourney(journey()), true);
  assert.equal(observed, 1); unsubscribe();
  assert.equal(await store.clearJourney(), true);
  assert.equal(observed, 1);
  assert.equal(store.getSnapshot, getSnapshot); assert.equal(store.subscribe, subscribe);
});
