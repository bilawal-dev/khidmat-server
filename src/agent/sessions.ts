import { RunnableConfig } from '@langchain/core/runnables';

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

// Evict sessions older than 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessed > 60 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();
