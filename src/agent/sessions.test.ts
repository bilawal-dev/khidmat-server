import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateSession, evictExpiredSessions } from './sessions';
import { SESSION_TTL_MS } from '../config/constants';

test('getOrCreateSession: creates once, then reuses the same config', () => {
  const first = getOrCreateSession('s1');
  assert.equal(first.isNew, true);

  const second = getOrCreateSession('s1');
  assert.equal(second.isNew, false);
  assert.equal(first.config, second.config);
});

test('getOrCreateSession: threads the session id into the config', () => {
  const { config } = getOrCreateSession('thread-42');
  assert.equal((config.configurable as any)?.thread_id, 'thread-42');
});

test('evictExpiredSessions: drops sessions idle past the TTL', () => {
  getOrCreateSession('s2');
  evictExpiredSessions(Date.now() + SESSION_TTL_MS + 1);
  // Recreated as new → it had been evicted.
  assert.equal(getOrCreateSession('s2').isNew, true);
});

test('evictExpiredSessions: keeps recently-accessed sessions', () => {
  getOrCreateSession('s3');
  evictExpiredSessions(Date.now());
  assert.equal(getOrCreateSession('s3').isNew, false);
});
