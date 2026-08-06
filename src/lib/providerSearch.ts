import { providers, type Provider, type ServiceCategory } from '../data/providers';
import { sectorCoords } from '../data/sectors';
import { haversineKm } from './geo';
import { isAffordable, minPrice } from './price';
import { hasSlot } from './availability';

/** How results can be ordered. `distance` requires a sector to measure from. */
export type ProviderSortBy = 'distance' | 'rating' | 'experience' | 'price';

export type ProviderSearchQuery = {
  category?: ServiceCategory;
  /** Sector to rank by proximity to (also enables `sortBy: 'distance'`). */
  near?: string;
  /** Keep only providers whose lowest price is at or below this ceiling. */
  maxPrice?: number;
  /** Keep only providers offering a slot matching this time (e.g. "2pm"). */
  availableAt?: string;
  sortBy?: ProviderSortBy;
  limit?: number;
};

/** A provider annotated with its distance from the requested sector (if any). */
export type RankedProvider = Provider & { distanceKm: number | null };

/** Attach a distance to `near`'s coordinates, or null when it can't be resolved. */
function withDistance(provider: Provider, origin?: { lat: number; lng: number }): RankedProvider {
  const distanceKm = origin ? Math.round(haversineKm(origin, provider.coords) * 10) / 10 : null;
  return { ...provider, distanceKm };
}

/**
 * Filter and rank the provider directory. Filters are ANDed; ranking falls back
 * to rating whenever a distance sort is requested but no origin is resolvable,
 * so a caller never gets an arbitrarily ordered list.
 */
export function searchProviders(query: ProviderSearchQuery = {}): RankedProvider[] {
  const { category, near, maxPrice, availableAt, sortBy = near ? 'distance' : 'rating', limit } =
    query;

  const origin = near ? sectorCoords(near) : undefined;

  let results = providers
    .filter((p) => (category ? p.category === category : true))
    .filter((p) => (maxPrice != null ? isAffordable(p.priceRange, maxPrice) : true))
    .filter((p) => (availableAt ? hasSlot(p, availableAt) : true))
    .map((p) => withDistance(p, origin));

  results = sortProviders(results, sortBy);

  return typeof limit === 'number' && limit > 0 ? results.slice(0, limit) : results;
}

/** Look up a single provider by its id, or null when no provider matches. */
export function getProviderById(id: string): Provider | null {
  return providers.find((p) => p.id === id) ?? null;
}

/**
 * Alternatives to a given provider: same category, ranked by proximity to that
 * provider's sector, excluding the provider itself. Returns [] when the id is
 * unknown so callers can treat "no such provider" and "no alternatives" alike.
 */
export function getSimilarProviders(id: string, limit = 3): RankedProvider[] {
  const target = getProviderById(id);
  if (!target) return [];

  return searchProviders({
    category: target.category,
    near: target.sector,
    sortBy: 'distance',
  })
    .filter((p) => p.id !== target.id)
    .slice(0, limit);
}

/** Order ranked providers by the chosen key, best-first, with sensible tiebreaks. */
function sortProviders(list: RankedProvider[], sortBy: ProviderSortBy): RankedProvider[] {
  const byRating = (a: RankedProvider, b: RankedProvider) =>
    b.rating - a.rating || b.reviewCount - a.reviewCount;

  if (sortBy === 'experience') {
    return [...list].sort((a, b) => b.yearsExperience - a.yearsExperience || byRating(a, b));
  }

  if (sortBy === 'price') {
    // Cheapest entry price first; equal prices fall back to rating.
    return [...list].sort(
      (a, b) => minPrice(a.priceRange) - minPrice(b.priceRange) || byRating(a, b),
    );
  }

  if (sortBy === 'distance') {
    return [...list].sort((a, b) => {
      // Providers with no measurable distance sink below those that have one.
      if (a.distanceKm == null && b.distanceKm == null) return byRating(a, b);
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm || byRating(a, b);
    });
  }

  return [...list].sort(byRating);
}
