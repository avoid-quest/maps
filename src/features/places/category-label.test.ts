import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCategoryLabel } from './category-label';

test('OpenStreetMap values from online search are shown in Italian', () => {
  assert.equal(placeCategoryLabel('tower'), 'Torre');
  assert.equal(placeCategoryLabel('attraction'), 'Attrazione');
  assert.equal(placeCategoryLabel('museum'), 'Museo');
  assert.equal(placeCategoryLabel('place_of_worship'), 'Luogo di culto');
  assert.equal(placeCategoryLabel('bus_stop'), 'Fermata bus');
  assert.equal(placeCategoryLabel('residential'), 'Via');
});

test('Overture categories keep their existing Italian labels and families', () => {
  assert.equal(placeCategoryLabel('pizza_restaurant'), 'Pizzeria');
  assert.equal(placeCategoryLabel('cafe'), 'Caffè');
  assert.equal(placeCategoryLabel('sushi_restaurant'), 'Ristorante');
  assert.equal(placeCategoryLabel('vintage_clothing_store'), 'Negozio');
  assert.equal(placeCategoryLabel('some_unknown_overture_kind'), 'Attività');
});

test('unknown raw tags never leak; app-written Italian labels pass through', () => {
  assert.equal(placeCategoryLabel('yes'), 'Luogo');
  assert.equal(placeCategoryLabel('windmill'), 'Luogo');
  assert.equal(placeCategoryLabel(''), 'Luogo');
  assert.equal(placeCategoryLabel(null), 'Luogo');
  assert.equal(placeCategoryLabel('Fermata GTT'), 'Fermata GTT');
});
