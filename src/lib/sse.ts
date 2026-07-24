import { Response } from 'express';
import { AgentEvent } from '../agent/events';

/** Serialize a payload as a single SSE `data:` frame. */
function writeData(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeEvent(res: Response, event: AgentEvent) {
  writeData(res, event);
}

/** Emit a terminal error frame on the SSE stream (not part of the AgentEvent union). */
export function writeError(res: Response, message: string) {
  writeData(res, { type: 'error', message });
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
