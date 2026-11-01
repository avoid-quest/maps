import test from 'node:test';
import assert from 'node:assert/strict';
import { idleNavigation, navigationFixPolicy, navigationLocationForReplan, navigationPresentation, type NavigationSnapshot } from './navigation';

const now = Date.UTC(2026, 9, 12, 12);
const usable: NavigationSnapshot = { ...idleNavigation, locationUsable: true, status: 'error', mode: 'transit', problem: 'transit-replan-needed',
  location: { latitude: 45, longitude: 7, accuracyMeters: 8, timestamp: now } };

test('transit replanning uses only a fresh precise fix and never a stale retained map dot', () => {
  assert.deepEqual(navigationLocationForReplan(usable, now), { latitude: 45, longitude: 7 });
  assert.deepEqual(navigationFixPolicy, { maximumFixAgeMillis: 15_000, originAccuracyMeters: 35 });
  assert.deepEqual(navigationLocationForReplan({ ...usable, location: { ...usable.location!, timestamp: now - 15_000, accuracyMeters: 35 } }, now), { latitude: 45, longitude: 7 });
  for (const patch of [
    { timestamp: now - 15_001 }, { timestamp: now + 1 }, { timestamp: NaN },
    { accuracyMeters: 35.01 }, { accuracyMeters: 50 }, { accuracyMeters: 0 }, { accuracyMeters: Infinity }, { latitude: 91 }, { longitude: -181 },
  ]) assert.equal(navigationLocationForReplan({ ...usable, location: { ...usable.location!, ...patch } }, now), null);
  assert.equal(navigationLocationForReplan({ ...usable, status: 'location-degraded' }, now), null);
  for (const problem of ['location-permission', 'location-disabled', 'location-stale', 'location-inaccurate'] as const) {
    assert.equal(navigationLocationForReplan({ ...usable, problem }, now), null);
  }
  assert.equal(navigationLocationForReplan({ ...usable, location: undefined }, now), null);
});

// Native keeps the actionable admission error and the old map dot when GPS confidence changes.
test('far-origin admission error cannot keep a replanning origin usable after GPS loss', () => {
  const farOrigin = { ...usable, locationUsable: true };
  assert.deepEqual(navigationLocationForReplan(farOrigin, now), { latitude: 45, longitude: 7 });
  const lost = { ...farOrigin, locationUsable: false };
  assert.equal(lost.problem, 'transit-replan-needed');
  assert.equal(navigationLocationForReplan(lost, now + 1000), null);
  const recovered = { ...lost, locationUsable: true, location: { ...lost.location!, timestamp: now + 2000 } };
  assert.deepEqual(navigationLocationForReplan(recovered, now + 2000), { latitude: 45, longitude: 7 });
});

const road: NavigationSnapshot = { ...idleNavigation, sessionId: 's', mode: 'car', status: 'waiting-for-fix', notificationGranted: true, requiredAccuracyMeters: 30 };

test('the start wait shows elapsed time and current against required accuracy', () => {
  const text = navigationPresentation({ ...road, waitingSinceMs: now - 12_400, lastFixAccuracyMeters: 38, fixProvider: 'gps' }, now);
  assert.equal(text.signal, 'Ricerca da 12 s · Segnale ±38 m, serve ±30 m');
  assert.equal(text.instruction, 'Attendi la posizione precisa');
  assert.equal(navigationPresentation({ ...road, waitingSinceMs: now - 3_000 }, now).signal, 'Ricerca da 3 s · Nessun segnale ricevuto');
});

test('a settled timeout says position not found with the weak signal and never "da ritrovare"', () => {
  const timedOut: NavigationSnapshot = { ...road, status: 'location-degraded', problem: 'location-inaccurate', startTimedOut: true,
    canRetry: true, waitingSinceMs: now - 45_000, lastFixAccuracyMeters: 500, bestRejectedAccuracyMeters: 500 };
  const text = navigationPresentation(timedOut, now);
  assert.equal(text.header, 'Posizione non trovata');
  assert.equal(text.instruction, 'Riprova o interrompi la navigazione');
  assert.equal(text.quality, 'Segnale troppo debole ±500 m (serve ±30 m). Spostati all’aperto e riprova.');
  assert.equal(text.signal, 'Ricerca da 45 s · Segnale ±500 m, serve ±30 m');
  const none = navigationPresentation({ ...timedOut, problem: 'location-unavailable', lastFixAccuracyMeters: undefined, bestRejectedAccuracyMeters: undefined }, now);
  assert.match(none.quality, /^Posizione non trovata: nessun segnale/);
  assert.match(none.signal ?? '', /Nessun segnale ricevuto/);
  // Even without the timeout flag, a degraded state that never had a position is "not found".
  const neverLocated = navigationPresentation({ ...road, status: 'location-degraded', problem: 'location-disabled' }, now);
  assert.equal(neverLocated.header, 'Posizione non trovata');
  for (const value of [text, none, neverLocated]) assert.ok(![value.header, value.instruction, value.quality].join(' ').includes('da ritrovare'));
});

test('guidance with reduced precision keeps going and shows the label', () => {
  const location = { latitude: 45, longitude: 7, accuracyMeters: 45, timestamp: now };
  const guiding: NavigationSnapshot = { ...road, mode: 'walk', status: 'navigating', locationUsable: true, location,
    instruction: 'Svolta a sinistra', distanceToManeuverMeters: 16, reducedPrecisionMeters: 45, lastFixAccuracyMeters: 45, requiredAccuracyMeters: 50 };
  const text = navigationPresentation(guiding, now);
  assert.equal(text.header, 'Tra 16 m');
  assert.equal(text.precision, 'Precisione ridotta ±45 m');
  assert.equal(text.signal, null);
  assert.equal(navigationPresentation({ ...guiding, reducedAccuracyStartMeters: 45 }, now).precision, 'Avvio con precisione ridotta ±45 m');
  assert.equal(navigationPresentation({ ...guiding, reducedPrecisionMeters: undefined }, now).precision, null);
  const paused = navigationPresentation({ ...guiding, status: 'location-degraded', locationUsable: false, problem: 'location-inaccurate', reducedPrecisionMeters: undefined, lastFixAccuracyMeters: 70 }, now);
  assert.equal(paused.header, 'Guida in pausa · Ultima indicazione');
  assert.equal(paused.signal, 'Segnale ±70 m, serve ±50 m');
});

test('an expired journey or missed boarding is flagged immediately during access walking', () => {
  const transit = { phase: 'walk' as const, legIndex: 0, legCount: 2, timingStatus: 'scheduled' as const, fetchedAt: now,
    canConfirmWalking: true, canConfirmBoarding: false, canConfirmAlighting: false };
  const following: NavigationSnapshot = { ...idleNavigation, sessionId: 's', mode: 'transit', status: 'navigating', transit };
  assert.equal(navigationPresentation({ ...following, transit: { ...transit, journeyArrivalAt: now + 600_000, nextBoardingAt: now + 300_000 } }, now).transitWarning, null);
  assert.match(navigationPresentation({ ...following, transit: { ...transit, journeyArrivalAt: now - 3_600_000, nextBoardingAt: now - 4_000_000 } }, now).transitWarning ?? '', /già concluso/);
  assert.match(navigationPresentation({ ...following, transit: { ...transit, journeyArrivalAt: now + 600_000, nextBoardingAt: now - 120_000 } }, now).transitWarning ?? '', /già partita/);
  // Without GPS, manual following is still guidance, not a paused state.
  const text = navigationPresentation({ ...following, locationUsable: false }, now);
  assert.equal(text.guiding, true); assert.equal(text.signal, null);
});

test('routing and rerouting say the route is being calculated; only the wait asks for a position', () => {
  const located = { ...road, location: { latitude: 45, longitude: 7, accuracyMeters: 10, timestamp: now } };
  assert.equal(navigationPresentation({ ...located, status: 'routing' }, now).instruction, 'Calcolo del percorso in corso');
  assert.equal(navigationPresentation({ ...located, status: 'rerouting' }, now).instruction, 'Ricalcolo del percorso in corso');
  assert.equal(navigationPresentation({ ...road, status: 'waiting-for-fix' }, now).instruction, 'Attendi la posizione precisa');
  // Start in flight before any session snapshot keeps the position-wait wording next to the spinner.
  assert.equal(navigationPresentation(idleNavigation, now, null, true).instruction, 'Attendi la posizione precisa');
  assert.equal(navigationPresentation(idleNavigation, now).instruction, 'In attesa di indicazioni');
});

test('a missed connection while aboard is flagged', () => {
  const transit = { phase: 'ride' as const, legIndex: 0, legCount: 3, timingStatus: 'scheduled' as const, fetchedAt: now,
    canConfirmWalking: false, canConfirmBoarding: false, canConfirmAlighting: true, journeyArrivalAt: now + 600_000, nextBoardingAt: now - 300_000 };
  assert.match(navigationPresentation({ ...idleNavigation, sessionId: 's', mode: 'transit', status: 'navigating', transit }, now).transitWarning ?? '', /già partita/);
});

test('off-route, rerouting and routing keep their own headers; only location loss pauses guidance', () => {
  const location = { latitude: 45, longitude: 7, accuracyMeters: 8, timestamp: now };
  const base: NavigationSnapshot = { ...road, mode: 'walk', locationUsable: true, location, instruction: 'Svolta a destra', lastFixAccuracyMeters: 8 };
  assert.equal(navigationPresentation({ ...base, status: 'off-route' }, now).header, 'Fuori percorso');
  assert.equal(navigationPresentation({ ...base, status: 'rerouting' }, now).header, 'Ricalcolo del percorso');
  assert.equal(navigationPresentation({ ...base, status: 'routing' }, now).header, 'Calcolo dalla tua posizione');
  for (const status of ['off-route', 'rerouting', 'routing'] as const) {
    const text = navigationPresentation({ ...base, status }, now);
    assert.equal(text.paused, false); assert.equal(text.signal, null);
  }
  assert.equal(navigationPresentation({ ...base, status: 'location-degraded', locationUsable: false, problem: 'location-inaccurate' }, now).header, 'Guida in pausa · Ultima indicazione');
  assert.equal(navigationPresentation({ ...base, status: 'navigating', locationUsable: false }, now).paused, true);
});
