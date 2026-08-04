import { Router, Request, Response } from 'express';
import { categoryStats } from '../lib/categoryStats';
import { handleSuccess } from '../lib/responseHandler';

export const categoriesRouter = Router();

/**
 * GET /categories — directory overview: one summary row per service category
 * (provider count, mean rating, cheapest entry price) for a browse landing.
 */
categoriesRouter.get('/', (_req: Request, res: Response) => {
  const categories = categoryStats();
  return handleSuccess(res, 200, `Found ${categories.length} categories`, {
    count: categories.length,
    categories,
  });
});
