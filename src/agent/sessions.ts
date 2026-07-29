import { RunnableConfig } from '@langchain/core/runnables';
import { SESSION_TTL_MS, SESSION_SWEEP_INTERVAL_MS } from '../config/constants';

type Session = {
  config: RunnableConfig;
  lastAccessed: number;
};

const sessions = new Map<string, Session>();

export function getOrCreateSession(sessionId: string): { config: RunnableConfig, isNew: boolean } {
  const now = Date.now();
  let session = sessions.get(sessionId);
  let isNew = false;
  if (!session) {
    session = {
      config: { configurable: { thread_id: sessionId } },
      lastAccessed: now,
    };
    sessions.set(sessionId, session);
    isNew = true;
  } else {
    session.lastAccessed = now;
  }
  return { config: session.config, isNew };
}

/**
 * Evict sessions idle past their TTL. Takes `now` so the sweep is a pure,
 * unit-testable function; the interval below calls it with the current time.
 */
export function evictExpiredSessions(now: number = Date.now()): void {
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessed > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

setInterval(() => evictExpiredSessions(), SESSION_SWEEP_INTERVAL_MS).unref();
