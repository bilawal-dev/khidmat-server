import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directoryStats } from './directoryStats';
import { providers, SERVICE_CATEGORIES } from '../data/providers';

test('totals match the seed data', () => {
  const stats = directoryStats();
  assert.equal(stats.totalProviders, providers.length);
  assert.equal(stats.totalCategories, SERVICE_CATEGORIES.length);
});

test('sectorsCovered counts distinct sectors', () => {
  const stats = directoryStats();
  const distinct = new Set(providers.map((p) => p.sector)).size;
  assert.equal(stats.sectorsCovered, distinct);
});

test('avgRating is within the rating bounds and rounded to 1 dp', () => {
  const { avgRating } = directoryStats();
  assert.ok(avgRating !== null);
  assert.ok(avgRating >= 4 && avgRating <= 5);
  assert.equal(avgRating, round1(avgRating));
});

test('cheapestFrom is the lowest entry price in the directory', () => {
  // Sajid Plumbing / Ahsan / etc. — cheapest entry across all data is 700.
  assert.equal(directoryStats().cheapestFrom, 700);
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
