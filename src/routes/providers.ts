import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ServiceCategoryEnum } from '../schemas/common';
import {
  searchProviders,
  getProviderById,
  getSimilarProviders,
  type ProviderSortBy,
} from '../lib/providerSearch';
import type { ServiceCategory } from '../data/providers';
import { paginate } from '../lib/paginate';
import { describeSlots } from '../lib/availability';
import { providerReviews } from '../lib/providerReviews';
import { handleSuccess, handleError } from '../lib/responseHandler';

export const providersRouter = Router();

const MAX_LIMIT = 50;

const ProviderQuerySchema = z.object({
  category: ServiceCategoryEnum.optional(),
  q: z.string().trim().min(1).optional(),
  near: z.string().trim().min(1).optional(),
  maxPrice: z.coerce.number().positive().optional(),
  availableAt: z.string().trim().min(1).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minExperience: z.coerce.number().int().nonnegative().optional(),
  sortBy: z.enum(['distance', 'rating', 'experience', 'price']).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
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

  const { category, q, near, maxPrice, availableAt, minRating, minExperience, sortBy, limit, offset } =
    parsed.data;
  // Rank the full matching set, then slice it — so `total`/`hasMore` reflect all
  // matches, not just the returned page.
  const ranked = searchProviders({
    category: category as ServiceCategory | undefined,
    q,
    near,
    maxPrice,
    availableAt,
    minRating,
    minExperience,
    sortBy: sortBy as ProviderSortBy | undefined,
  });
  const page = paginate(ranked, { offset, limit });

  return handleSuccess(res, 200, `Found ${page.total} providers`, {
    count: page.items.length,
    total: page.total,
    offset: page.offset,
    hasMore: page.hasMore,
    providers: page.items,
  });
});

/**
 * GET /providers/:id/similar — same-category alternatives near the provider.
 * 404s when the provider id itself is unknown; an empty list means the provider
 * exists but has no alternatives.
 */
providersRouter.get('/:id/similar', (req: Request, res: Response) => {
  if (!getProviderById(req.params.id)) {
    return handleError(res, 404, `Provider not found: ${req.params.id}`);
  }

  const similar = getSimilarProviders(req.params.id);
  return handleSuccess(res, 200, `Found ${similar.length} similar providers`, {
    count: similar.length,
    providers: similar,
  });
});

/**
 * GET /providers/:id/slots — the provider's available slots in display,
 * canonical, and minutes-since-midnight forms, sorted by time. 404s when the
 * provider id is unknown.
 */
providersRouter.get('/:id/slots', (req: Request, res: Response) => {
  const provider = getProviderById(req.params.id);
  if (!provider) {
    return handleError(res, 404, `Provider not found: ${req.params.id}`);
  }

  const slots = describeSlots(provider);
  return handleSuccess(res, 200, `Found ${slots.length} slots`, {
    count: slots.length,
    slots,
  });
});

/**
 * GET /providers/:id/reviews — a deterministic review summary (average, star
 * breakdown, sample snippets) synthesized from the provider's rating and review
 * count. 404s when the provider id is unknown.
 */
providersRouter.get('/:id/reviews', (req: Request, res: Response) => {
  const provider = getProviderById(req.params.id);
  if (!provider) {
    return handleError(res, 404, `Provider not found: ${req.params.id}`);
  }

  return handleSuccess(res, 200, 'Provider reviews', providerReviews(provider));
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
