import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceRange, minPrice, isAffordable } from './price';

test('parses a standard range', () => {
  assert.deepEqual(parsePriceRange('PKR 1500-3000'), { min: 1500, max: 3000 });
});

test('ignores a trailing unit suffix', () => {
  assert.deepEqual(parsePriceRange('PKR 3000-6000/mo'), { min: 3000, max: 6000 });
});

test('a single number becomes an equal min/max', () => {
  assert.deepEqual(parsePriceRange('PKR 2000'), { min: 2000, max: 2000 });
});

test('strips thousands separators', () => {
  assert.deepEqual(parsePriceRange('PKR 1,500-10,000'), { min: 1500, max: 10000 });
});

test('returns null when there are no digits', () => {
  assert.equal(parsePriceRange('Contact for quote'), null);
});

test('minPrice returns the low end, or Infinity when unparseable', () => {
  assert.equal(minPrice('PKR 800-2000'), 800);
  assert.equal(minPrice('free estimate'), Infinity);
});

test('isAffordable checks the low end against a ceiling', () => {
  assert.equal(isAffordable('PKR 1500-3000', 2000), true); // 1500 <= 2000
  assert.equal(isAffordable('PKR 1500-3000', 1000), false); // 1500 > 1000
  assert.equal(isAffordable('n/a', 5000), false); // unparseable
});
