import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

type LogLevel = 'info' | 'warn' | 'error';

/** Map an HTTP status code to a log level: 5xx → error, 4xx → warn, else info. */
export function levelForStatus(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/**
 * Logs one line per request when the response finishes, with method, path,
 * status code, and wall-clock duration. Kept dependency-free (no morgan) since
 * the output just needs to flow through our own logger.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    // requestId middleware runs first; fall back gracefully if it didn't.
    const id = (req as Request & { requestId?: string }).requestId;
    const suffix = id ? ` [${id}]` : '';
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms${suffix}`;
    logger[levelForStatus(res.statusCode)](line);
  });

  next();
}
