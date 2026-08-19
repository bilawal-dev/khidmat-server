import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerReviews } from './providerReviews';
import type { Provider } from '../data/providers';

const stub = {
  id: 'p007',
  rating: 4.8,
  reviewCount: 167,
} as unknown as Provider;

test('breakdown counts sum exactly to the review total', () => {
  const reviews = providerReviews(stub);
  const sum = reviews.breakdown.reduce((acc, b) => acc + b.count, 0);
  assert.equal(sum, 167);
  assert.equal(reviews.total, 167);
});

test('average mirrors the provider rating', () => {
  assert.equal(providerReviews(stub).average, 4.8);
});

test('breakdown weights the star nearest the average highest', () => {
  const reviews = providerReviews(stub);
  const modal = reviews.breakdown.reduce((a, b) => (b.count > a.count ? b : a));
  assert.equal(modal.stars, 5); // 4.8 average → 5 stars is the mode
});

test('is deterministic for the same provider', () => {
  assert.deepEqual(providerReviews(stub), providerReviews(stub));
});

test('provides three sample snippets', () => {
  assert.equal(providerReviews(stub).samples.length, 3);
});

test('handles a provider with zero reviews', () => {
  const empty = { id: 'p999', rating: 4, reviewCount: 0 } as unknown as Provider;
  const reviews = providerReviews(empty);
  assert.equal(reviews.total, 0);
  assert.equal(reviews.breakdown.reduce((a, b) => a + b.count, 0), 0);
});
