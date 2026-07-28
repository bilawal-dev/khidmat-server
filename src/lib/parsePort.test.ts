import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePort } from './parsePort';

test('parsePort: accepts a valid positive integer port', () => {
  assert.equal(parsePort('5000'), 5000);
  assert.equal(parsePort('1'), 1);
});

test('parsePort: rejects non-numeric input', () => {
  assert.equal(parsePort('abc'), null);
  assert.equal(parsePort(''), null);
});

test('parsePort: rejects zero, negatives, and non-integers', () => {
  assert.equal(parsePort('0'), null);
  assert.equal(parsePort('-3'), null);
  assert.equal(parsePort('80.5'), null);
});
