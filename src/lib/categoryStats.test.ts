import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryStats, statsForCategory } from './categoryStats';
import { SERVICE_CATEGORIES } from '../data/providers';

test('categoryStats returns one entry per category, in order', () => {
  const stats = categoryStats();
  assert.equal(stats.length, SERVICE_CATEGORIES.length);
  assert.deepEqual(
    stats.map((s) => s.category),
    [...SERVICE_CATEGORIES],
  );
});

test('every category in the seed data has providers', () => {
  for (const stat of categoryStats()) {
    assert.ok(stat.providerCount > 0, `${stat.category} should have providers`);
  }
});

test('avgRating is rounded to one decimal place', () => {
  const stat = statsForCategory('ac');
  assert.ok(stat.avgRating !== null);
  // AC ratings: 4.7, 4.5, 4.3 → mean 4.5
  assert.equal(stat.avgRating, 4.5);
});

test('fromPrice is the cheapest entry price in the category', () => {
  // AC providers start at 1500, 2000, 1000 → cheapest 1000.
  assert.equal(statsForCategory('ac').fromPrice, 1000);
});
