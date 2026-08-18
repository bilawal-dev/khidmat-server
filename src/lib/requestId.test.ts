import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidRequestId, resolveRequestId } from './requestId';

test('accepts a sane client id', () => {
  assert.equal(isValidRequestId('abc-123'), true);
  assert.equal(isValidRequestId('550e8400-e29b-41d4-a716-446655440000'), true);
});

test('rejects empty, non-string, over-long, or non-printable ids', () => {
  assert.equal(isValidRequestId(''), false);
  assert.equal(isValidRequestId(undefined), false);
  assert.equal(isValidRequestId(123), false);
  assert.equal(isValidRequestId('a'.repeat(129)), false);
  assert.equal(isValidRequestId('has space'), false);
  assert.equal(isValidRequestId('line\nbreak'), false);
});

test('resolveRequestId honours a valid client id', () => {
  assert.equal(resolveRequestId('trace-42'), 'trace-42');
});

test('resolveRequestId generates a UUID when the client id is invalid', () => {
  const id = resolveRequestId('bad id');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('generated ids are unique across calls', () => {
  assert.notEqual(resolveRequestId(undefined), resolveRequestId(undefined));
});
