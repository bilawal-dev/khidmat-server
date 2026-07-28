import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from './logger';

/** Capture the args passed to a console method while `fn` runs. */
function capture(method: 'log' | 'warn' | 'error', fn: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const original = console[method];
  (console as any)[method] = (...args: unknown[]) => calls.push(args);
  try {
    fn();
  } finally {
    (console as any)[method] = original;
  }
  return calls;
}

const LINE = /^\[server\] \d{4}-\d{2}-\d{2}T[\d:.]+Z (INFO|WARN|ERROR) /;

test('logger.info: prefix, ISO timestamp, level, message; routes to console.log', () => {
  const calls = capture('log', () => logger.info('hello'));
  assert.equal(calls.length, 1);
  const line = calls[0][0] as string;
  assert.match(line, LINE);
  assert.ok(line.endsWith('INFO hello'));
});

test('logger.warn: routes to console.warn', () => {
  const calls = capture('warn', () => logger.warn('careful'));
  assert.equal(calls.length, 1);
  assert.ok((calls[0][0] as string).endsWith('WARN careful'));
});

test('logger.error: routes to console.error and forwards meta', () => {
  const meta = { code: 1 };
  const calls = capture('error', () => logger.error('boom', meta));
  assert.equal(calls.length, 1);
  assert.ok((calls[0][0] as string).endsWith('ERROR boom'));
  assert.equal(calls[0][1], meta);
});
