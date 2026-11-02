import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransitousConsent, TRANSITOUS_CONSENT_KEY } from './transitous-consent';

function memory(initial: Record<string, string> = {}, failing = false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key: string) => { if (failing) throw new Error('unavailable'); return values.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (failing) throw new Error('unavailable'); values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
}

test('no request is consented until the disclosure is acknowledged, and the acknowledgement persists', async () => {
  const consent = createTransitousConsent();
  assert.deepEqual(consent.getSnapshot(), { ready: false, accepted: false });
  const storage = memory();
  await consent.initialize(storage);
  assert.deepEqual(consent.getSnapshot(), { ready: true, accepted: false });
  await consent.accept();
  assert.equal(consent.getSnapshot().accepted, true);
  assert.equal(storage.values.get(TRANSITOUS_CONSENT_KEY), JSON.stringify({ version: 1, accepted: true }));
  const later = createTransitousConsent();
  await later.initialize(storage);
  assert.equal(later.getSnapshot().accepted, true);
  await later.revoke();
  assert.equal(later.getSnapshot().accepted, false);
  assert.equal(storage.values.has(TRANSITOUS_CONSENT_KEY), false);
});

test('an unreadable or foreign record shows the disclosure again; failed storage keeps a session-only choice', async () => {
  for (const raw of ['{', JSON.stringify({ version: 2, accepted: true }), JSON.stringify({ version: 1, accepted: 'yes' }), 'x'.repeat(300)]) {
    const consent = createTransitousConsent();
    await consent.initialize(memory({ [TRANSITOUS_CONSENT_KEY]: raw }));
    assert.deepEqual(consent.getSnapshot(), { ready: true, accepted: false }, raw.slice(0, 20));
  }
  const consent = createTransitousConsent();
  await consent.initialize(memory({}, true));
  assert.deepEqual(consent.getSnapshot(), { ready: true, accepted: false });
  await consent.accept();
  assert.equal(consent.getSnapshot().accepted, true);
});
