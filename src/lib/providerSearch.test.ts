import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProviders, getProviderById } from './providerSearch';
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

test('maxPrice keeps only providers with an affordable entry price', () => {
  const results = searchProviders({ category: 'tutor', maxPrice: 2500 });
  assert.ok(results.length > 0);
  // Every result must have a tier starting at or below 2500.
  assert.ok(results.every((p) => Number(p.priceRange.match(/\d+/)![0]) <= 2500));
  // Ayesha Math Academy starts at 3000, so it must be filtered out.
  assert.ok(!results.some((p) => p.id === 'p010'));
});

test('sortBy price ranks the cheapest entry price first', () => {
  const results = searchProviders({ category: 'ac', sortBy: 'price' });
  assert.equal(results[0].id, 'p003'); // Khan Cooling — starts at PKR 1000
});

test('availableAt keeps only providers offering that slot', () => {
  const results = searchProviders({ category: 'ac', availableAt: '2pm' });
  assert.ok(results.length > 0);
  assert.ok(results.every((p) => p.availableSlots.some((s) => /2:00 PM/.test(s))));
  // Khan Cooling (p003) only has 9/1/5 — no 2 PM — so it must be excluded.
  assert.ok(!results.some((p) => p.id === 'p003'));
});

test('limit caps the number of results', () => {
  const results = searchProviders({ limit: 3 });
  assert.equal(results.length, 3);
});

test('a non-positive limit is ignored', () => {
  const results = searchProviders({ limit: 0 });
  assert.equal(results.length, providers.length);
});

test('getProviderById returns the matching provider', () => {
  const provider = getProviderById('p001');
  assert.ok(provider);
  assert.equal(provider?.name, 'Ali AC Services');
});

test('getProviderById returns null for an unknown id', () => {
  assert.equal(getProviderById('nope'), null);
});
