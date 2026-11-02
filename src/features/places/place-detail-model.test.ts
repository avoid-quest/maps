import test from 'node:test';
import assert from 'node:assert/strict';
import { confidenceLabel, freshnessLabel, sourceDate, sourceLines, websiteLabel } from './place-detail-model';

test('websites read without scheme, www or trailing slash', () => {
  assert.equal(websiteLabel('https://www.eataly.net/it_it/negozi/torino-lagrange'), 'eataly.net/it_it/negozi/torino-lagrange');
  assert.equal(websiteLabel('http://example.it/'), 'example.it');
  assert.equal(websiteLabel('example.it/menu'), 'example.it/menu');
});

test('source dates keep the upstream date part, with or without a timezone', () => {
  assert.equal(sourceDate('2026-09-17T22:52:12Z'), '17/09/2026');
  assert.equal(sourceDate('2022-02-03T08:09:10'), '03/02/2022');
  assert.equal(sourceDate(''), null);
  assert.equal(sourceDate(null), null);
  assert.equal(freshnessLabel({ dataUpdatedAt: '' }), 'Data di aggiornamento non indicata dalla fonte');
  assert.equal(freshnessLabel({ dataUpdatedAt: '2026-09-17T22:52:12Z' }), 'Ultimo aggiornamento indicato dalle fonti: 17/09/2026');
});

test('each contributing record is listed with the field it supplied, its licence and its date', () => {
  const lines = sourceLines({
    provenance: [
      { dataset: 'meta', license: 'CDLA-Permissive-2.0', property: '', update_time: '2026-09-14T00:00:00.000Z' },
      { dataset: 'Overture', license: 'CDLA-Permissive-2.0', property: '/properties/confidence', update_time: '2026-09-17T22:52:12Z' },
      { dataset: 'Foursquare', license: 'Apache-2.0', property: '/properties/phones/0', update_time: null },
    ],
    attributions: ['meta · CDLA-Permissive-2.0', 'Overture · CDLA-Permissive-2.0', 'Foursquare · Apache-2.0', 'Telefono corretto da sito ufficiale · https://example.it/ · 2026-10-11'],
  });
  assert.deepEqual(lines, [
    'meta · CDLA-Permissive-2.0 · aggiornato il 14/09/2026',
    'Overture (affidabilità) · CDLA-Permissive-2.0 · aggiornato il 17/09/2026',
    'Foursquare (telefono) · Apache-2.0 · data non indicata',
    'Telefono corretto da sito ufficiale · https://example.it/ · 2026-10-11',
  ]);
  assert.deepEqual(sourceLines({ attributions: ['© OpenStreetMap contributors · ODbL'] }), ['© OpenStreetMap contributors · ODbL']);
});

test('confidence is an existence estimate for Overture records only', () => {
  assert.equal(confidenceLabel({ confidence: 0.7602, source: 'Overture Places' }), 'Esistenza stimata da Overture: 76% (non indica se è aperto ora)');
  assert.equal(confidenceLabel({ confidence: 0.9, source: 'Photon / OpenStreetMap' }), null);
  assert.equal(confidenceLabel({ confidence: null, source: 'Overture Places' }), null);
});
