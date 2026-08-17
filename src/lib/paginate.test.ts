import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './paginate';

const items = [1, 2, 3, 4, 5];

test('no options returns everything, hasMore false', () => {
  const page = paginate(items);
  assert.deepEqual(page.items, items);
  assert.equal(page.total, 5);
  assert.equal(page.hasMore, false);
  assert.equal(page.limit, null);
});

test('limit slices from the front and flags more', () => {
  const page = paginate(items, { limit: 2 });
  assert.deepEqual(page.items, [1, 2]);
  assert.equal(page.hasMore, true);
});

test('offset skips items', () => {
  const page = paginate(items, { offset: 3, limit: 2 });
  assert.deepEqual(page.items, [4, 5]);
  assert.equal(page.hasMore, false);
});

test('offset past the end yields an empty page', () => {
  const page = paginate(items, { offset: 10, limit: 2 });
  assert.deepEqual(page.items, []);
  assert.equal(page.hasMore, false);
  assert.equal(page.total, 5);
});

test('negative offset and non-positive limit are normalized', () => {
  const page = paginate(items, { offset: -5, limit: 0 });
  assert.deepEqual(page.items, items); // offset→0, limit→all
  assert.equal(page.offset, 0);
  assert.equal(page.limit, null);
});
