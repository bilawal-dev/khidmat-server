import { env } from './config/env';
import express, { Request, Response, NextFunction } from 'express';
import { handleSuccess, handleError } from './lib/responseHandler';
import { chatRouter } from './routes/chat';
import { logger } from './lib/logger';
import { requestLogger } from './lib/requestLogger';
import cors from 'cors';

const app = express();

// Restrict CORS to the configured origins when CORS_ORIGINS is set; otherwise
// stay permissive (default) since the mobile client sends no browser Origin.
app.use(cors(env.CORS_ORIGINS ? { origin: env.CORS_ORIGINS } : undefined));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/', (_req: Request, res: Response) => {
  return handleSuccess(res, 200, 'Khidmat agent server', {
    service: 'khidmat-server',
    endpoints: ['GET /health', 'POST /chat'],
  });
});

app.get('/health', (_req: Request, res: Response) => {
  return handleSuccess(res, 200, 'Health Check Passed', {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.use('/chat', chatRouter);

// Unmatched routes get a consistent JSON 404 instead of Express's default HTML.
app.use((req: Request, res: Response) => {
  return handleError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', err);
  return handleError(res, 500, 'Internal Server Error');
});

const server = app.listen(env.PORT, () => {
  logger.info(`Listening on http://localhost:${env.PORT}`);
});

// Drain in-flight requests on a shutdown signal so the process exits cleanly
// (e.g. under a container orchestrator) instead of dropping live connections.
const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  // Don't hang forever if a long-lived connection (e.g. an open SSE stream)
  // refuses to drain — force the exit after a grace period.
  setTimeout(() => {
    logger.error('Shutdown timed out; forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort visibility: never let a stray rejection or throw die silently.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});
