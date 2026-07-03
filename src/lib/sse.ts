import { Response } from 'express';
import { AgentEvent } from '../agent/events';

export function writeEvent(res: Response, event: AgentEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Emit a terminal error frame on the SSE stream (not part of the AgentEvent union). */
export function writeError(res: Response, message: string) {
  res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
}

export function initSSE(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}
