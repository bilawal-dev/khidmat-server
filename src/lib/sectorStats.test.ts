import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorStats } from './sectorStats';
import { providers } from '../data/providers';

test('lists every sector that has providers, and only those', () => {
  const stats = sectorStats();
  const expected = new Set(providers.map((p) => p.sector));
  assert.equal(stats.length, expected.size);
  assert.ok(stats.every((s) => expected.has(s.sector)));
});

test('provider counts sum to the total provider count', () => {
  const total = sectorStats().reduce((sum, s) => sum + s.providerCount, 0);
  assert.equal(total, providers.length);
});

test('is sorted by provider count descending', () => {
  const stats = sectorStats();
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i - 1].providerCount >= stats[i].providerCount);
  }
});

test('categories are distinct within a sector', () => {
  for (const stat of sectorStats()) {
    assert.equal(stat.categories.length, new Set(stat.categories).size);
  }
});

test('F-7 has two providers (Sajid Plumbing + Maria Beauty Salon)', () => {
  const f7 = sectorStats().find((s) => s.sector === 'F-7');
  assert.ok(f7);
  assert.equal(f7?.providerCount, 2);
  assert.deepEqual([...(f7?.categories ?? [])].sort(), ['beautician', 'plumber']);
});
