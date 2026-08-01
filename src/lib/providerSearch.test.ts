import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProviders } from './providerSearch';
import { providers } from '../data/providers';

test('with no query, returns every provider ranked by rating', () => {
  const results = searchProviders();
  assert.equal(results.length, providers.length);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].rating >= results[i].rating);
  }
});

test('filters by category', () => {
  const results = searchProviders({ category: 'plumber' });
  assert.ok(results.length > 0);
  assert.ok(results.every((p) => p.category === 'plumber'));
});

test('near a sector sorts by distance ascending', () => {
  const results = searchProviders({ category: 'ac', near: 'G-13' });
  assert.ok(results.every((p) => typeof p.distanceKm === 'number'));
  for (let i = 1; i < results.length; i++) {
    assert.ok((results[i - 1].distanceKm ?? 0) <= (results[i].distanceKm ?? 0));
  }
  // G-13 is Ali AC Services' own sector, so it should rank first (distance ~0).
  assert.equal(results[0].id, 'p001');
});

test('without a sector, distance is null and rating orders the list', () => {
  const results = searchProviders({ category: 'ac' });
  assert.ok(results.every((p) => p.distanceKm === null));
  assert.equal(results[0].id, 'p001'); // 4.7 — highest-rated AC provider
});

test('sortBy experience ranks the most seasoned provider first', () => {
  const results = searchProviders({ category: 'plumber', sortBy: 'experience' });
  assert.equal(results[0].id, 'p004'); // Sajid Plumbing — 12 years
});

test('limit caps the number of results', () => {
  const results = searchProviders({ limit: 3 });
  assert.equal(results.length, 3);
});

test('a non-positive limit is ignored', () => {
  const results = searchProviders({ limit: 0 });
  assert.equal(results.length, providers.length);
});
