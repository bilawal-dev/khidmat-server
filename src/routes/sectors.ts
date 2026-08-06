import { Router, Request, Response } from 'express';
import { sectorStats } from '../lib/sectorStats';
import { handleSuccess } from '../lib/responseHandler';

export const sectorsRouter = Router();

/**
 * GET /sectors — browse the areas the directory covers: one row per sector with
 * a provider count, coordinates, and the categories available there.
 */
sectorsRouter.get('/', (_req: Request, res: Response) => {
  const sectors = sectorStats();
  return handleSuccess(res, 200, `Found ${sectors.length} sectors`, {
    count: sectors.length,
    sectors,
  });
});
