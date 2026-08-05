import { Router, Request, Response } from 'express';
import { directoryStats } from '../lib/directoryStats';
import { handleSuccess } from '../lib/responseHandler';

export const statsRouter = Router();

/**
 * GET /stats — whole-directory overview (totals, sectors covered, mean rating,
 * cheapest entry price) for a landing/summary view.
 */
statsRouter.get('/', (_req: Request, res: Response) => {
  return handleSuccess(res, 200, 'Directory stats', directoryStats());
});
