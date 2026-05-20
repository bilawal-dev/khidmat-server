import { AgentEvent } from './events';
import { EventQueue } from './eventQueue';
import { graph } from './graph';
import { getOrCreateSession } from './sessions';
import { HumanMessage } from '@langchain/core/messages';
import { GraphInterrupt } from '@langchain/langgraph';
import { Booking } from '../schemas/booking';
import * as crypto from 'crypto';

export async function* runAgent(input: { message: string, sessionId?: string, defaultLocation?: string, bookings?: Booking[] }): AsyncGenerator<AgentEvent> {
  const queue = new EventQueue();

  // If a request comes without sessionId, create a new thread_id and process as a fresh conversation
  // (one-shot, no resume possible since the FE doesn't know the ID).
  const sessionId = input.sessionId || crypto.randomUUID();
  const { config, isNew } = getOrCreateSession(sessionId);

  if (input.sessionId && isNew) {
    // Stale session
    queue.push({ type: 'thought', text: 'Session expired, starting over.' });
  }

  // Inject EventQueue and defaultLocation into config
  const runnableConfig = {
    ...config,
    configurable: {
      ...config.configurable,
      eventQueue: queue,
      defaultLocation: input.defaultLocation,
      bookings: input.bookings,
    }
  };

  // Run graph in background, piping events into queue
  (async () => {
    try {
      await graph.invoke({ messages: [new HumanMessage(input.message)] }, runnableConfig);
    } catch (err: any) {
      if (err && (err instanceof GraphInterrupt || err.name === 'GraphInterrupt')) {
        // Expected interrupt, graph pauses cleanly
      } else {
        console.error('[server] Graph execution error:', err);
      }
    } finally {
      queue.end();
    }
  })();

  // Yield events from the queue as they arrive
  for await (const event of queue) {
    yield event;
  }
}
