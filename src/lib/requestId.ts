import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Correlation id for a request. If the client sends a sane `X-Request-Id` we
 * honour it (so a trace id can span client → server → logs); otherwise we mint
 * one. The value is echoed back on the response and attached to `req` for the
 * logger to pick up.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Max length we accept from a client, to bound log line size / abuse. */
const MAX_REQUEST_ID_LENGTH = 128;

/** Whether a client-supplied id is safe to echo: printable ASCII, bounded. */
export function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

/** Use the client's id when valid, otherwise generate a fresh UUID. */
export function resolveRequestId(headerValue: unknown): string {
  return isValidRequestId(headerValue) ? headerValue : randomUUID();
}

/** Express middleware: resolve, expose on `req.requestId`, and echo on response. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = resolveRequestId(req.header(REQUEST_ID_HEADER));
  (req as Request & { requestId: string }).requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
