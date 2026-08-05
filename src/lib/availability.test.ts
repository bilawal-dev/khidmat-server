import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlot, hasSlot } from './availability';
import type { Provider } from '../data/providers';

test('normalizeSlot canonicalizes 12-hour strings', () => {
  assert.equal(normalizeSlot('10:00 AM'), '10:00am');
  assert.equal(normalizeSlot('2:00 PM'), '2:00pm');
  assert.equal(normalizeSlot('2pm'), '2:00pm');
});

test('normalizeSlot infers meridiem from 24-hour input', () => {
  assert.equal(normalizeSlot('14:00'), '2:00pm');
  assert.equal(normalizeSlot('09:30'), '9:30am');
  assert.equal(normalizeSlot('00:00'), '12:00am');
});

test('normalizeSlot rejects nonsense', () => {
  assert.equal(normalizeSlot('later'), null);
  assert.equal(normalizeSlot('25:00'), null);
});

const stub = {
  id: 'x',
  availableSlots: ['10:00 AM', '2:00 PM', '6:00 PM'],
} as unknown as Provider;

test('hasSlot matches regardless of input format', () => {
  assert.equal(hasSlot(stub, '2pm'), true);
  assert.equal(hasSlot(stub, '14:00'), true);
  assert.equal(hasSlot(stub, '10:00 AM'), true);
});

test('hasSlot is false when the provider lacks the slot', () => {
  assert.equal(hasSlot(stub, '9am'), false);
  assert.equal(hasSlot(stub, 'whenever'), false);
});
