import { env } from './config/env';
import express, { Request, Response, NextFunction } from 'express';
import { handleSuccess, handleError } from './lib/responseHandler';
import { chatRouter } from './routes/chat';
import { logger } from './lib/logger';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req: Request, res: Response) => {
  return handleSuccess(res, 200, "Health Check Passed");
});

app.use('/chat', chatRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', err);
  return handleError(res, 500, 'Internal Server Error');
});

app.listen(env.PORT, () => {
  logger.info(`Listening on http://localhost:${env.PORT}`);
});
