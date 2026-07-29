import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelForStatus } from './requestLogger';

test('levelForStatus: 2xx/3xx are info', () => {
  assert.equal(levelForStatus(200), 'info');
  assert.equal(levelForStatus(204), 'info');
  assert.equal(levelForStatus(302), 'info');
});

test('levelForStatus: 4xx are warn', () => {
  assert.equal(levelForStatus(400), 'warn');
  assert.equal(levelForStatus(404), 'warn');
  assert.equal(levelForStatus(499), 'warn');
});

test('levelForStatus: 5xx are error', () => {
  assert.equal(levelForStatus(500), 'error');
  assert.equal(levelForStatus(503), 'error');
});
