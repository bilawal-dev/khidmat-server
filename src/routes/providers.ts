import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ServiceCategoryEnum } from '../schemas/common';
import { searchProviders, getProviderById, type ProviderSortBy } from '../lib/providerSearch';
import type { ServiceCategory } from '../data/providers';
import { handleSuccess, handleError } from '../lib/responseHandler';

export const providersRouter = Router();

const MAX_LIMIT = 50;

const ProviderQuerySchema = z.object({
  category: ServiceCategoryEnum.optional(),
  near: z.string().trim().min(1).optional(),
  maxPrice: z.coerce.number().positive().optional(),
  sortBy: z.enum(['distance', 'rating', 'experience', 'price']).optional(),
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

  const { category, near, maxPrice, sortBy, limit } = parsed.data;
  const results = searchProviders({
    category: category as ServiceCategory | undefined,
    near,
    maxPrice,
    sortBy: sortBy as ProviderSortBy | undefined,
    limit,
  });

  return handleSuccess(res, 200, `Found ${results.length} providers`, {
    count: results.length,
    providers: results,
  });
});

/**
 * GET /providers/:id — fetch a single provider by id. Returns a 404 in the
 * standard envelope when no provider matches, so clients can branch on
 * `success` instead of parsing status codes.
 */
providersRouter.get('/:id', (req: Request, res: Response) => {
  const provider = getProviderById(req.params.id);
  if (!provider) {
    return handleError(res, 404, `Provider not found: ${req.params.id}`);
  }

  return handleSuccess(res, 200, 'Provider found', { provider });
});
