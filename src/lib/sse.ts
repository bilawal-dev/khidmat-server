import { Response } from 'express';
import { AgentEvent } from '../agent/events';

export function writeEvent(res: Response, event: AgentEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
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
