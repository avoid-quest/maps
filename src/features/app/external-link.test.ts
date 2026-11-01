import test from 'node:test';
import assert from 'node:assert/strict';
import { LINK_FAILURE, openExternalLink } from './external-link';

async function attempt(url: string, open: (url: string) => Promise<unknown> = async () => {}) {
  const opened: string[] = []; const reported: string[] = [];
  await openExternalLink(url, async target => { opened.push(target); return open(target); }, message => reported.push(message));
  return { opened, reported };
}

test('web and telephone links open without feedback', async () => {
  assert.deepEqual(await attempt('https://www.openstreetmap.org/'), { opened: ['https://www.openstreetmap.org/'], reported: [] });
  assert.deepEqual(await attempt('tel:+390113358869'), { opened: ['tel:+390113358869'], reported: [] });
});

test('unsupported or failing links are reported instead of ignored', async () => {
  assert.deepEqual(await attempt('not a host'), { opened: [], reported: [LINK_FAILURE] });
  assert.deepEqual(await attempt('javascript:alert(1)'), { opened: [], reported: [LINK_FAILURE] });
  assert.deepEqual(await attempt('https://example.it', async () => { throw new Error('no handler'); }), { opened: ['https://example.it'], reported: [LINK_FAILURE] });
});

test('scheme-less place websites open over https', async () => {
  assert.deepEqual(await attempt('www.example.it'), { opened: ['https://www.example.it'], reported: [] });
  assert.deepEqual(await attempt('ficeriafllisalvioni.website/'), { opened: ['https://ficeriafllisalvioni.website/'], reported: [] });
  assert.deepEqual(await attempt(' example.it/menu?x=1 '), { opened: ['https://example.it/menu?x=1'], reported: [] });
  assert.deepEqual(await attempt('mailto:a@example.it'), { opened: [], reported: [LINK_FAILURE] }, 'explicit non-web schemes stay rejected');
});
