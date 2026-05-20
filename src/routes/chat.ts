import { Router, Request, Response } from 'express';
import { ChatRequestSchema } from '../schemas/chat';
import { initSSE, writeEvent } from '../lib/sse';
import { runAgent } from '../agent/runAgent';
import { handleError } from '../lib/responseHandler';

export const chatRouter = Router();

chatRouter.post('/', async (req: Request, res: Response) => {
  const parseResult = ChatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return handleError(res, 400, 'Invalid request', parseResult.error.format());
  }

  initSSE(res);

  const generator = runAgent(parseResult.data);

  req.on('close', () => {
    generator.return(undefined);
  });

  try {
    for await (const event of generator) {
      writeEvent(res, event);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
  } finally {
    res.end();
  }
});
