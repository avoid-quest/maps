import test from 'node:test';
import assert from 'node:assert/strict';
import portaSusa from '../../tests/fixtures/transitous/stoptimes-porta-susa.json';
import portaNuova from '../../tests/fixtures/transitous/stoptimes-porta-nuova.json';
import lingotto from '../../tests/fixtures/transitous/stoptimes-lingotto.json';
import gttQuestura from '../../tests/fixtures/transitous/stoptimes-gtt-2198.json';
import trip26481 from '../../tests/fixtures/transitous/trip-sfm-26481.json';
import portaSusaArrivals from '../../tests/fixtures/transitous/stoptimes-porta-susa-arrivals.json';
import unknownStop from '../../tests/fixtures/transitous/error-unknown-stop.json';
import geocodeLingotto from '../../tests/fixtures/transitous/geocode-lingotto.json';
import mapStopsPortaSusa from '../../tests/fixtures/transitous/map-stops-porta-susa.json';
import type { Stop, TransitBoardRow } from '../domain/types';
import { boardTime, delayMinutes, realtimeStateLabel } from '../domain/transit-board';
import { TURIN_CENTER, distanceMeters } from './geo';
import { ServiceError } from './network';
import {
  classifyEvent, createTransitousClient, parseStopMatches, parseStopTimes, parseTrip, TRANSITOUS_MIN_REFRESH_MS,
  TRANSITOUS_PRIVACY_NOTES, transitousGttStopId, transitousUserAgent,
} from './transitous';
import { getRailPilotStation, nearestRailPilotStations, RAIL_PILOT_DATA, RAIL_PILOT_STATIONS } from './transitous-stations';

const UA = transitousUserAgent('0.1.9');
const QUESTURA: Stop = { id: '2198', code: '30', name: 'Fermata 30 - QUESTURA', coordinate: { latitude: 45.07123, longitude: 7.66921 }, lines: [] };
const PORTA_SUSA = getRailPilotStation('torino-porta-susa')!;
const direct = <T>(request: () => Promise<T>) => request();
const clone = <T>(value: T): T => structuredClone(value);
/** Fixture recording times (UTC); boards drop events already past at retrieval. */
const SUSA_AT = Date.parse('2026-11-01T19:12:00Z'); const GTT_AT = Date.parse('2026-11-01T19:10:00Z');
const clientAt = (now: number) => createTransitousClient({ userAgent: UA, now: () => now, queue: direct });
type Call = { url: string; headers: Record<string, string> };

async function withFetch<T>(respond: (url: string) => Response | Promise<Response>, run: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = global.fetch; const calls: Call[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return respond(url);
  }) as typeof fetch;
  try { return await run(calls); } finally { global.fetch = original; }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const at = (iso: string) => Date.parse(iso);
const row = (rows: TransitBoardRow[], name: string) => {
  const found = rows.find(r => r.displayName === name); assert.ok(found, `row ${name}`); return found;
};

test('User-Agent identifies only app, version and public repository', () => {
  assert.equal(UA, 'AvoidMaps/0.1.9 (+https://github.com/avoid-quest/maps)');
  assert.equal(transitousUserAgent(undefined), 'AvoidMaps/unknown (+https://github.com/avoid-quest/maps)');
  assert.equal(transitousUserAgent('1.0 (Pixel; user@example.com)'), 'AvoidMaps/unknown (+https://github.com/avoid-quest/maps)');
});

test('rail board sends only the station ID and parses declared realtime, schedules, operators and attribution', async () => {
  const now = SUSA_AT;
  await withFetch(() => json(portaSusa), async calls => {
    const client = createTransitousClient({ userAgent: UA, now: () => now, queue: direct });
    const board = await client.getRailStationBoard(PORTA_SUSA);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.transitous.org/api/v6/stoptimes?stopId=it-trenitalia_00222&n=12');
    assert.deepEqual(Object.keys(calls[0]!.headers).sort(), ['Accept', 'User-Agent']);
    assert.equal(calls[0]!.headers['User-Agent'], UA);

    assert.equal(board.provider, 'transitous'); assert.equal(board.event, 'departure');
    assert.equal(board.stop.name, 'Torino Porta Susa'); assert.equal(board.rows.length, 12);
    assert.equal(board.retrievedAt, now); assert.equal(board.nextRefreshAt, now + TRANSITOUS_MIN_REFRESH_MS);
    for (const r of board.rows) { assert.equal(r.sourceUpdatedAt, undefined, 'never manufactured'); assert.equal(r.retrievedAt, now); assert.equal(r.provider, 'transitous'); }

    const fr = row(board.rows, 'FR 9320');
    assert.equal(fr.mode, 'rail-high-speed'); assert.equal(fr.line, 'FR'); assert.equal(fr.tripNumber, '9320');
    assert.equal(fr.realtimeState, 'declared-realtime-no-source-time'); assert.equal(fr.timeBasis, 'predicted');
    assert.equal(fr.scheduledAt, at('2026-11-01T19:10:00Z')); assert.equal(fr.predictedAt, at('2026-11-01T19:12:00Z'));
    assert.equal(delayMinutes(fr), 2);
    assert.deepEqual(fr.upstream, { operator: 'TRENITALIA', attribution: 'BusOne (https://busone.app) and Trenitalia', dataset: 'it_trenitalia.gtfs.zip' });
    assert.equal(realtimeStateLabel(fr), 'Dichiarato in tempo reale · aggiornamento origine non disponibile');
    assert.equal(delayMinutes(row(board.rows, 'RV 2038')), 7);
    assert.equal(delayMinutes(row(board.rows, 'RV 2778')), -2, 'early trains keep a negative delay');

    const sched = row(board.rows, 'RV 2743');
    assert.equal(sched.realtimeState, 'scheduled'); assert.equal(sched.predictedAt, undefined);
    assert.equal(sched.scheduledAt, at('2026-11-01T19:29:00Z')); assert.equal(delayMinutes(sched), undefined);
    assert.equal(realtimeStateLabel(sched), 'Orario programmato · nessun dato in tempo reale');

    const tgv = row(board.rows, 'TGV INOUI 9255');
    assert.equal(tgv.headsign, undefined, 'empty headsign stays unknown'); assert.equal(tgv.destination, 'MILANO PORTA GARIBALDI');
    assert.equal(tgv.upstream.operator, 'SNCF VOYAGEURS'); assert.equal(tgv.upstream.attribution, undefined);
    assert.equal(tgv.upstream.dataset, 'fr_horaires-sncf.netex.zip'); assert.equal(tgv.line, undefined); assert.equal(tgv.tripNumber, '9255');
    assert.deepEqual(board.attributions, [
      'Transitous (https://transitous.org/sources/)', 'BusOne (https://busone.app) and Trenitalia', 'Altre fonti originali: https://transitous.org/sources/',
    ]);
    assert.equal(board.sourcesUrl, 'https://transitous.org/sources/');
    assert.deepEqual(board.warnings, []);
  });
});

test('verified encoding glitch is corrected only for the Trenitalia dataset and keeps the supplied text', () => {
  const parsed = parseStopTimes(portaSusa, { event: 'departure', retrievedAt: 1 });
  const ciri = parsed.rows.find(r => r.tripNumber === '26481')!;
  assert.equal(ciri.headsign, 'Ciriè'); assert.equal(ciri.headsignAsSupplied, 'Ciri');
  assert.equal(parsed.rows.find(r => r.tripNumber === '26074')!.headsignAsSupplied, undefined);

  const gtt = clone(gttQuestura); gtt.stopTimes[0]!.headsign = 'Ciri';
  const gttRow = parseStopTimes(gtt, { event: 'departure', retrievedAt: 1 }).rows[0]!;
  assert.equal(gttRow.headsign, 'Ciri'); assert.equal(gttRow.headsignAsSupplied, undefined);
  const partial = clone(portaSusa); partial.stopTimes[2]!.headsign = 'Ciri Nord';
  assert.equal(parseStopTimes(partial, { event: 'departure', retrievedAt: 1 }).rows[2]!.headsign, 'Ciri Nord', 'only whole-string matches');
});

test('platforms are reported as published, without inventing a scheduled/actual split', () => {
  const rows = parseStopTimes(lingotto, { event: 'departure', retrievedAt: 1 }).rows;
  assert.deepEqual(rows[0]!.platform, { scheduled: undefined, current: '3', changed: false });
  const changed = clone(lingotto); Object.assign(changed.stopTimes[1]!.place, { scheduledTrack: '4' });
  assert.deepEqual(parseStopTimes(changed, { event: 'departure', retrievedAt: 1 }).rows[1]!.platform, { scheduled: '4', current: '5', changed: true });
  assert.equal(parseStopTimes(portaSusa, { event: 'departure', retrievedAt: 1 }).rows[0]!.platform, undefined);
});

test('a board without realtime says so instead of implying punctuality', async () => {
  await withFetch(() => json(portaNuova), async () => {
    const board = await clientAt(at('2026-11-01T19:19:00Z')).getRailStationBoard(getRailPilotStation('torino-porta-nuova')!);
    assert.ok(board.rows.every(r => r.realtimeState === 'scheduled'));
    assert.deepEqual(board.warnings, ['Nessun dato in tempo reale: sono mostrati solo orari programmati.']);
  });
});

test('arrivals ask for upcoming events and the board keeps only the current window', async () => {
  const recordedAt = at('2026-11-01T20:10:00Z');
  await withFetch(() => json(portaSusaArrivals), async calls => {
    const board = await clientAt(recordedAt).getRailStationBoard(PORTA_SUSA, { event: 'arrival' });
    assert.equal(calls[0]!.url, 'https://api.transitous.org/api/v6/stoptimes?stopId=it-trenitalia_00222&n=12&arriveBy=true&direction=LATER');
    assert.equal(board.event, 'arrival'); assert.equal(board.rows.length, 12);
    for (const r of board.rows) assert.ok(boardTime(r)! >= recordedAt - 2 * 60_000, r.displayName);
    const rv = row(board.rows, 'RV 2038');
    assert.equal(rv.scheduledAt, at('2026-11-01T19:54:00Z')); assert.equal(rv.predictedAt, at('2026-11-01T20:11:00Z'), 'late arrival kept by its prediction');
    assert.ok(board.rows.some(r => r.stop.id === 'fr-horaires-des-trains-trenitalia-france_10001'), 'same-station equivalent accepted');
  });
  await withFetch(() => json(portaSusaArrivals), async () => {
    // A response containing past arrivals (as with MOTIS's default direction) shows only the remaining window.
    const later = at('2026-11-01T20:40:00Z');
    const board = await clientAt(later).getRailStationBoard(PORTA_SUSA, { event: 'arrival' });
    assert.deepEqual(board.rows.map(r => r.displayName), ['FR 9808', 'FR 9552', 'SFM 26294', 'RV 2040', 'RV 2045']);
    assert.ok(board.rows.every(r => boardTime(r)! >= later - 2 * 60_000));
  });
});

test('each event must be at the requested stop or an accepted station equivalent', async () => {
  const wrongPole = clone(gttQuestura);
  wrongPole.stopTimes[1]!.place.stopId = 'it-Piemonte-Gruppo-Torinese-Trasporti_2199';
  Object.assign(wrongPole.stopTimes[2]!.place, { lat: 45.08, lon: 7.66921 });
  await withFetch(() => json(wrongPole), async () => {
    const board = await clientAt(GTT_AT).getGttStopFallbackBoard(QUESTURA);
    assert.equal(board.rows.length, 6);
    assert.ok(board.rows.every(r => r.stop.id === 'it-Piemonte-Gruppo-Torinese-Trasporti_2198'));
    assert.ok(board.warnings.includes('2 corse scartate perché riferite a un’altra fermata.'));
  });
  const elsewhere = clone(portaSusa);
  Object.assign(elsewhere.stopTimes[1]!.place, { stopId: 'it-trenitalia_00452', name: 'TORINO LINGOTTO', lat: 45.026604, lon: 7.65747 });
  await withFetch(() => json(elsewhere), async () => {
    const board = await clientAt(SUSA_AT).getRailStationBoard(PORTA_SUSA);
    assert.equal(board.rows.length, 11);
    assert.ok(!board.rows.some(r => r.stop.id === 'it-trenitalia_00452'));
    assert.ok(board.rows.some(r => r.displayName === 'TGV INOUI 9255' && r.stop.id.startsWith('fr-horaires-sncf_')), 'SNCF equivalent still accepted');
    assert.ok(board.warnings.includes('1 corse scartate perché riferite a un’altra fermata.'));
  });
});

test('a claimed prediction with an unreadable time is unknown, not a silent timetable time', () => {
  const data = clone(portaSusa);
  data.stopTimes[0]!.place.departure = 'garbage';
  delete (data.stopTimes[1]!.place as { departure?: string }).departure;
  data.stopTimes[2]!.place.scheduledDeparture = 'garbage';
  const [bad, missing, noSchedule] = parseStopTimes(data, { event: 'departure', retrievedAt: 1 }).rows;
  assert.equal(bad!.realtimeState, 'unknown'); assert.equal(bad!.timeBasis, 'predicted');
  assert.equal(bad!.predictedAt, undefined); assert.equal(bad!.scheduledAt, at('2026-11-01T19:10:00Z'));
  assert.equal(realtimeStateLabel(bad!), 'Stato in tempo reale non determinabile'); assert.equal(delayMinutes(bad!), undefined);
  assert.equal(missing!.realtimeState, 'unknown'); assert.equal(missing!.predictedAt, undefined);
  assert.equal(noSchedule!.realtimeState, 'declared-realtime-no-source-time', 'a readable prediction stays realtime');
  assert.equal(noSchedule!.scheduledAt, undefined); assert.equal(delayMinutes(noSchedule!), undefined);
});

test('GTT fallback derives the Transitous ID, restricts to the pole and labels inconsistent realtime as unknown', async () => {
  await withFetch(() => json(gttQuestura), async calls => {
    const board = await clientAt(GTT_AT).getGttStopFallbackBoard(QUESTURA);
    assert.equal(calls[0]!.url, 'https://api.transitous.org/api/v6/stoptimes?stopId=it-Piemonte-Gruppo-Torinese-Trasporti_2198&n=10&radius=0&exactRadius=true');
    assert.equal(board.stop.id, '2198');
    assert.ok(board.warnings[0]!.startsWith('Fonte: Transitous (dati GTT tramite BusOne)'));
    assert.deepEqual(board.attributions, ['Transitous (https://transitous.org/sources/)', 'BusOne (https://busone.app) and GTT']);
    const inconsistent = board.rows.find(r => r.timeBasis === 'inconsistent')!;
    assert.equal(inconsistent.line, '19'); assert.equal(inconsistent.mode, 'bus');
    assert.equal(inconsistent.realtimeState, 'unknown'); assert.equal(inconsistent.predictedAt, undefined);
    assert.equal(inconsistent.scheduledAt, at('2026-11-01T19:05:00Z')); assert.equal(inconsistent.providerTimeAt, at('2026-11-01T19:10:00Z'));
    assert.equal(realtimeStateLabel(inconsistent), 'Dati in tempo reale incoerenti · orario non confermato');
    const tram = board.rows.find(r => r.line === '9' && r.realtimeState === 'declared-realtime-no-source-time')!;
    assert.equal(tram.mode, 'tram'); assert.equal(tram.upstream.operator, 'GTT Servizio Urbano'); assert.equal(tram.tripNumber, undefined);
  });
});

test('GTT fallback refuses a response that cannot be joined to the selected stop', async () => {
  await withFetch(() => json(gttQuestura), async () => {
    const client = createTransitousClient({ userAgent: UA, queue: direct });
    await assert.rejects(client.getGttStopFallbackBoard({ ...QUESTURA, coordinate: { latitude: 45.08, longitude: 7.66921 } }), (error: unknown) => error instanceof ServiceError && error.kind === 'invalid');
    client.clearCache();
    await assert.rejects(client.getGttStopFallbackBoard({ ...QUESTURA, code: '31' }), { kind: 'invalid' });
  });
  assert.throws(() => transitousGttStopId('2198&center=45,7'), { kind: 'invalid' });
  assert.equal(transitousGttStopId('6'), 'it-Piemonte-Gruppo-Torinese-Trasporti_6');
});

test('rail board refuses a station that drifted from the verified mapping', async () => {
  const moved = clone(portaSusa); moved.place.stopId = 'it-trenitalia_99999';
  await withFetch(() => json(moved), async () => {
    await assert.rejects(createTransitousClient({ userAgent: UA, queue: direct }).getRailStationBoard(PORTA_SUSA), { kind: 'invalid' });
  });
});

test('cancelled trips and skipped stops become cancelled rows without a realtime time', () => {
  // Derived from a recorded row: no cancellation occurred during the 2026-11-01 probes.
  const data = clone(portaSusa);
  Object.assign(data.stopTimes[0]!, { cancelled: true, tripCancelled: true });
  Object.assign(data.stopTimes[1]!, { cancelled: true, tripCancelled: false });
  const [trip, skipped] = parseStopTimes(data, { event: 'departure', retrievedAt: 1 }).rows;
  assert.equal(trip!.realtimeState, 'cancelled'); assert.equal(trip!.tripCancelled, true); assert.equal(trip!.predictedAt, undefined);
  assert.equal(trip!.scheduledAt, at('2026-11-01T19:10:00Z'));
  assert.equal(realtimeStateLabel(trip!), 'Corsa cancellata');
  assert.equal(skipped!.realtimeState, 'cancelled'); assert.equal(skipped!.tripCancelled, false);
  assert.equal(realtimeStateLabel(skipped!), 'Fermata soppressa per questa corsa');
});

test('missing and malformed fields stay unknown or drop the row, never guessed', () => {
  const data = clone(portaSusa) as { stopTimes: unknown[]; place: unknown };
  const first = data.stopTimes[0] as Record<string, unknown> & { place: Record<string, unknown> };
  first.mode = 'HOVERCRAFT'; delete first.agencyName; delete first.source;
  data.stopTimes[1] = { ...(data.stopTimes[1] as object), place: undefined };
  const third = data.stopTimes[2] as { place: Record<string, unknown> };
  third.place.departure = 'tomorrow'; third.place.scheduledDeparture = 12345;
  data.stopTimes.push('garbage', null);
  const parsed = parseStopTimes(data, { event: 'departure', retrievedAt: 1 });
  assert.equal(parsed.dropped, 4); assert.equal(parsed.rows.length, 10);
  const odd = parsed.rows[0]!;
  assert.equal(odd.mode, 'unknown'); assert.equal(odd.providerMode, 'HOVERCRAFT');
  assert.deepEqual(odd.upstream, { operator: undefined, attribution: undefined, dataset: undefined });

  assert.throws(() => parseStopTimes([], { event: 'departure', retrievedAt: 1 }), { kind: 'invalid' });
  assert.throws(() => parseStopTimes({ stopTimes: [], place: { name: 'x' } }, { event: 'departure', retrievedAt: 1 }), { kind: 'invalid' });
});

test('realtime classification treats contradictions as unknown', () => {
  const c = (realTime: unknown, reason: unknown, cancelled = false, tripCancelled = false) => classifyEvent({ realTime, reason, cancelled, tripCancelled }).state;
  assert.equal(c(true, 'PREDICTED'), 'declared-realtime-no-source-time');
  assert.equal(c(true, 'OBSERVED'), 'declared-realtime-no-source-time');
  assert.equal(c(true, 'PROPAGATED'), 'declared-realtime-no-source-time');
  assert.equal(c(false, 'NO_RT_DATA'), 'scheduled');
  assert.equal(c(true, 'NO_RT_DATA'), 'unknown');
  assert.equal(c(false, 'PREDICTED'), 'unknown');
  assert.equal(c(false, 'INCONSISTENT_RT'), 'unknown');
  assert.equal(c(true, 'SOMETHING_NEW'), 'unknown');
  assert.equal(c(true, undefined), 'declared-realtime-no-source-time');
  assert.equal(c(false, undefined), 'scheduled');
  assert.equal(c(undefined, undefined), 'unknown');
  assert.equal(c(true, 'PREDICTED', true), 'cancelled');
});

test('trip details request omits geometry and parse intermediate stops with their own time basis', async () => {
  const tripRef = '20261101_19:07_it-trenitalia_0083_720083_0_v_72-26481-34C1-0083_v_72-26481-34C1-0083';
  await withFetch(() => json(trip26481), async calls => {
    const trip = await createTransitousClient({ userAgent: UA, queue: direct }).getTripDetails(tripRef);
    assert.equal(calls[0]!.url, `https://api.transitous.org/api/v6/trip?tripId=${encodeURIComponent(tripRef)}&detailedLegs=false`);
    assert.equal(trip.displayName, 'SFM 26481'); assert.equal(trip.mode, 'rail-suburban');
    assert.equal(trip.headsign, 'Ciriè'); assert.equal(trip.realtimeState, 'declared-realtime-no-source-time');
    assert.equal(trip.stops.length, 23); assert.equal(trip.sourceUpdatedAt, undefined);
    const [alba] = trip.stops; const last = trip.stops.at(-1)!;
    assert.equal(alba!.name, 'ALBA'); assert.equal(alba!.departureBasis, 'observed'); assert.equal(alba!.predictedDepartureAt, at('2026-11-01T18:07:00Z'));
    assert.equal(last.name, 'Ciriè'); assert.equal(last.nameAsSupplied, 'Ciri'); assert.equal(last.predictedArrivalAt, at('2026-11-01T20:10:00Z'));
    const moncalieri = trip.stops.find(s => s.name === 'MONCALIERI')!;
    assert.equal(moncalieri.arrivalBasis, 'predicted'); assert.equal(moncalieri.platform?.current, '5');
    const ps = trip.stops.find(s => s.stopId === 'it-trenitalia_00222')!;
    assert.equal(ps.platform, undefined); assert.equal(ps.cancelled, false);
    assert.deepEqual(trip.attributions, ['Transitous (https://transitous.org/sources/)', 'BusOne (https://busone.app) and Trenitalia']);
  });
});

test('stop search sends the typed text with a fixed region box, never a position', async () => {
  await withFetch(() => json(geocodeLingotto), async calls => {
    const matches = await createTransitousClient({ userAgent: UA, queue: direct }).searchStops(' Lingotto ');
    assert.equal(calls[0]!.url, 'https://api.transitous.org/api/v1/geocode?text=Lingotto&type=STOP&numResults=8&min=44.9%2C7.4&max=45.3%2C7.95');
    assert.ok(!calls[0]!.url.includes('place='));
    assert.equal(matches.find(m => m.stopId === 'it-trenitalia_00452:station')?.name, 'Turin - Lingotto');
  });
  const stops = parseStopMatches(mapStopsPortaSusa);
  assert.ok(stops.some(s => s.stopId === 'it-trenitalia_00222'));
  assert.deepEqual(parseStopMatches([{ stopId: 'x', name: 'no coordinate' }, 'bad']), []);
});

test('manual refresh inside 60 s of elapsed time returns the cached snapshot; later refresh fetches again', async () => {
  let wall = SUSA_AT; let mono = 5_000;
  await withFetch(() => json(portaSusa), async calls => {
    const client = createTransitousClient({ userAgent: UA, now: () => wall, monotonic: () => mono, queue: direct });
    const first = await client.getRailStationBoard(PORTA_SUSA);
    wall += TRANSITOUS_MIN_REFRESH_MS - 1; mono += TRANSITOUS_MIN_REFRESH_MS - 1;
    const second = await client.getRailStationBoard(PORTA_SUSA);
    assert.equal(calls.length, 1); assert.equal(second, first); assert.equal(second.retrievedAt, SUSA_AT, 'wall-clock retrieval time preserved');
    mono += 1;
    const third = await client.getRailStationBoard(PORTA_SUSA);
    assert.equal(calls.length, 2); assert.equal(third.retrievedAt, wall);
  });
});

test('wall-clock corrections neither extend nor shorten cache freshness', async () => {
  let wall = SUSA_AT; let mono = 0;
  await withFetch(() => json(portaSusa), async calls => {
    const client = createTransitousClient({ userAgent: UA, now: () => wall, monotonic: () => mono, queue: direct });
    await client.getRailStationBoard(PORTA_SUSA);
    wall += 59_000; mono += 59_000;
    await client.getRailStationBoard(PORTA_SUSA); assert.equal(calls.length, 1);
    wall -= 58_000; mono += 2_000; // clock rolled back, but 61 s really elapsed
    await client.getRailStationBoard(PORTA_SUSA); assert.equal(calls.length, 2, 'rollback must not extend the cache');
    wall += 3_600_000; mono += 1_000; // clock jumped forward, only 1 s elapsed
    await client.getRailStationBoard(PORTA_SUSA); assert.equal(calls.length, 2, 'forward jump does not force a request');
  });
});

test('provider errors map to rate-limit and not-found service errors and are not cached', async () => {
  let status = 429;
  await withFetch(() => status === 200 ? json(portaSusa) : json(unknownStop, status), async calls => {
    const client = createTransitousClient({ userAgent: UA, queue: direct });
    await assert.rejects(client.getRailStationBoard(PORTA_SUSA), (error: unknown) => error instanceof ServiceError && error.kind === 'rate-limit');
    status = 404;
    await assert.rejects(client.getGttStopFallbackBoard(QUESTURA), (error: unknown) => error instanceof ServiceError && error.status === 404 && error.message === 'Fermata non trovata su Transitous.');
    status = 200;
    await client.getRailStationBoard(PORTA_SUSA);
    assert.equal(calls.length, 3);
  });
});

test('cancellation before and during a request sends nothing further and caches nothing', async () => {
  let release!: () => void;
  await withFetch(() => json(portaSusa), async calls => {
    const client = createTransitousClient({ userAgent: UA, queue: direct });
    const before = new AbortController(); before.abort();
    await assert.rejects(client.getRailStationBoard(PORTA_SUSA, { signal: before.signal }), { name: 'AbortError' });
    assert.equal(calls.length, 0);
  });
  await withFetch(() => new Promise<Response>(resolve => { release = () => resolve(json(portaSusa)); }), async calls => {
    const client = createTransitousClient({ userAgent: UA, queue: direct });
    const during = new AbortController();
    const pending = client.getRailStationBoard(PORTA_SUSA, { signal: during.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    during.abort(); release();
    await assert.rejects(pending, { name: 'AbortError' });
    const retry = client.getRailStationBoard(PORTA_SUSA);
    await new Promise(resolve => setTimeout(resolve, 0)); release();
    await retry; assert.equal(calls.length, 2, 'aborted response was not cached');
  });
});

test('the default queue spaces requests to the provider', async () => {
  const starts: number[] = [];
  await withFetch(() => { starts.push(performance.now()); return json(portaSusa); }, async () => {
    const client = createTransitousClient({ userAgent: UA });
    await Promise.all([client.getRailStationBoard(PORTA_SUSA), client.getGttStopFallbackBoard(QUESTURA).catch(() => undefined)]);
  });
  assert.equal(starts.length, 2); assert.ok(starts[1]! - starts[0]! >= 990, `spacing ${starts[1]! - starts[0]!}`);
});

test('rail pilot mapping is small, unique, Turin-area and looked up locally', () => {
  const ids = RAIL_PILOT_STATIONS.map(s => s.transitousStopId);
  assert.equal(new Set(ids).size, ids.length); assert.equal(new Set(RAIL_PILOT_STATIONS.map(s => s.key)).size, ids.length);
  assert.ok(ids.length >= 10 && ids.length <= 30);
  for (const station of RAIL_PILOT_STATIONS) {
    assert.match(station.transitousStopId, /^it-trenitalia_\d{5}$/);
    assert.ok(distanceMeters(TURIN_CENTER, station.coordinate) < 25_000, station.key);
  }
  assert.equal(RAIL_PILOT_DATA.verifiedAt, '2026-11-01');
  assert.deepEqual(RAIL_PILOT_DATA.excluded.map(e => e.name), ['Torino Dora', 'Torino Zappata', 'Torino San Paolo']);
  assert.equal(nearestRailPilotStations({ latitude: 45.0741, longitude: 7.6672 })[0]?.key, 'torino-porta-susa');
  assert.deepEqual(nearestRailPilotStations({ latitude: 41.9, longitude: 12.5 }), []);
});

test('privacy notes describe exactly what each request sends', () => {
  assert.match(TRANSITOUS_PRIVACY_NOTES.stopFallback, /solo il codice della fermata selezionata/);
  assert.match(TRANSITOUS_PRIVACY_NOTES.stopFallback, /posizione non viene inviata/);
  assert.match(TRANSITOUS_PRIVACY_NOTES.stopFallback, /indirizzo IP, ora e nome e versione dell’app/);
  assert.match(TRANSITOUS_PRIVACY_NOTES.stopFallback, /2 giorni/);
  assert.match(TRANSITOUS_PRIVACY_NOTES.railBoard, /codice della stazione/);
  assert.match(TRANSITOUS_PRIVACY_NOTES.stopSearch, /testo digitato e un riquadro fisso/);
});

test('stop lookup around a public stop sends only a small box around that stop', async () => {
  await withFetch(() => json(mapStopsPortaSusa), async calls => {
    const matches = await createTransitousClient({ userAgent: UA, queue: direct }).stopsAroundPublicStop(PORTA_SUSA);
    assert.equal(calls[0]!.url, 'https://api.transitous.org/api/v6/map/stops?min=45.07275%2C7.66535&max=45.07545%2C7.66915');
    assert.ok(matches.some(m => m.stopId === 'it-trenitalia_00222'));
  });
});

test('trip summary comes from parsed stop events, not the endpoint-only leg flag', () => {
  const tripRef = 'trip';
  const endpointsScheduled = clone(trip26481);
  const leg = endpointsScheduled.legs[0]! as Record<string, unknown> & { from: Record<string, unknown>; to: Record<string, unknown>; intermediateStops: Record<string, unknown>[] };
  leg.realTime = false; leg.from.departureTimestampReason = 'NO_RT_DATA'; leg.to.arrivalTimestampReason = 'NO_RT_DATA';
  leg.to.arrival = leg.to.scheduledArrival;
  const mixed = parseTrip(endpointsScheduled, { tripRef, retrievedAt: 1 });
  assert.equal(mixed.endpointRealtimeFlag, false);
  assert.equal(mixed.realtimeState, 'declared-realtime-no-source-time', 'intermediate PREDICTED stops make the trip realtime');
  assert.equal(mixed.stops[0]!.departureBasis, 'scheduled');
  assert.equal(mixed.stops.find(s => s.name === 'MONCALIERI')!.arrivalBasis, 'predicted');

  const allScheduled = clone(endpointsScheduled);
  const legAll = allScheduled.legs[0]! as typeof leg;
  for (const place of [legAll.from, ...legAll.intermediateStops, legAll.to]) {
    if (place.arrivalTimestampReason) place.arrivalTimestampReason = 'NO_RT_DATA';
    if (place.departureTimestampReason) place.departureTimestampReason = 'NO_RT_DATA';
  }
  legAll.realTime = true;
  const scheduled = parseTrip(allScheduled, { tripRef, retrievedAt: 1 });
  assert.equal(scheduled.realtimeState, 'scheduled'); assert.equal(scheduled.endpointRealtimeFlag, true);

  const unreadable = clone(allScheduled);
  const stop = (unreadable.legs[0]! as typeof leg).intermediateStops[3]!;
  stop.arrivalTimestampReason = 'PREDICTED'; stop.arrival = 'garbage';
  const parsed = parseTrip(unreadable, { tripRef, retrievedAt: 1 });
  assert.equal(parsed.stops[4]!.arrivalBasis, 'unknown'); assert.equal(parsed.stops[4]!.predictedArrivalAt, undefined);
  assert.equal(parsed.realtimeState, 'unknown');

  const real = parseTrip(trip26481, { tripRef, retrievedAt: 1 });
  assert.equal(real.realtimeState, 'declared-realtime-no-source-time'); assert.equal(real.endpointRealtimeFlag, true);
});
