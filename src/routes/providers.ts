import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ServiceCategoryEnum } from '../schemas/common';
import { searchProviders, type ProviderSortBy } from '../lib/providerSearch';
import type { ServiceCategory } from '../data/providers';
import { handleSuccess, handleError } from '../lib/responseHandler';

export const providersRouter = Router();

const MAX_LIMIT = 50;

const ProviderQuerySchema = z.object({
  category: ServiceCategoryEnum.optional(),
  near: z.string().trim().min(1).optional(),
  sortBy: z.enum(['distance', 'rating', 'experience']).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

/**
 * GET /providers — browse/search the provider directory. All query params are
 * optional; `near=<sector>` annotates each result with a distance and defaults
 * the ordering to nearest-first. Returns the standard API envelope.
 */
providersRouter.get('/', (req: Request, res: Response) => {
  const parsed = ProviderQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return handleError(res, 400, 'Invalid query parameters', parsed.error.format());
  }

  const { category, near, sortBy, limit } = parsed.data;
  const results = searchProviders({
    category: category as ServiceCategory | undefined,
    near,
    sortBy: sortBy as ProviderSortBy | undefined,
    limit,
  });

  return handleSuccess(res, 200, `Found ${results.length} providers`, {
    count: results.length,
    providers: results,
  });
});
