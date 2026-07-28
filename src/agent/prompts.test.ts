import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifierPrompt,
  intentExtractionPrompt,
  bookingFlowSystem,
  disambiguationPrompt,
} from './prompts';

test('classifierPrompt: names the four flows and embeds the message', () => {
  const p = classifierPrompt('kal AC chahiye', []);
  for (const flow of ['new_booking', 'modify_booking', 'cancel_booking', 'query_booking']) {
    assert.ok(p.includes(flow), `missing flow ${flow}`);
  }
  assert.ok(p.includes('kal AC chahiye'));
});

test('intentExtractionPrompt: lists categories and includes the history', () => {
  const p = intentExtractionPrompt('human: need a plumber', ['ac', 'plumber']);
  assert.ok(p.includes('ac, plumber'));
  assert.ok(p.includes('human: need a plumber'));
});

test('bookingFlowSystem: interpolates role, summary, and instructions', () => {
  const p = bookingFlowSystem('canceling an existing booking', '1. id=b1', 'Call the tool.');
  assert.ok(p.includes('canceling an existing booking'));
  assert.ok(p.includes('1. id=b1'));
  assert.ok(p.includes('Call the tool.'));
});

test('disambiguationPrompt: includes the phrase and the empty-string rule', () => {
  const p = disambiguationPrompt('the AC one', [{ id: 'b1' }]);
  assert.ok(p.includes('the AC one'));
  assert.ok(p.includes('"b1"') || p.includes('b1'));
  assert.ok(/empty string/i.test(p));
});
