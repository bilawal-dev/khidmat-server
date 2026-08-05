import { providers, SERVICE_CATEGORIES } from '../data/providers';
import { parsePriceRange } from './price';

/** Directory-wide totals for a top-level overview / landing endpoint. */
export type DirectoryStats = {
  totalProviders: number;
  totalCategories: number;
  /** Distinct sectors covered by at least one provider. */
  sectorsCovered: number;
  /** Mean rating across every provider, rounded to 1 dp; null when empty. */
  avgRating: number | null;
  /** Cheapest entry price found anywhere in the directory; null when none. */
  cheapestFrom: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Compute the whole-directory summary from the seed provider data. */
export function directoryStats(): DirectoryStats {
  const totalProviders = providers.length;

  const avgRating = totalProviders
    ? round1(providers.reduce((sum, p) => sum + p.rating, 0) / totalProviders)
    : null;

  const sectorsCovered = new Set(providers.map((p) => p.sector)).size;

  const entryPrices = providers
    .map((p) => parsePriceRange(p.priceRange)?.min)
    .filter((n): n is number => typeof n === 'number');
  const cheapestFrom = entryPrices.length ? Math.min(...entryPrices) : null;

  return {
    totalProviders,
    totalCategories: SERVICE_CATEGORIES.length,
    sectorsCovered,
    avgRating,
    cheapestFrom,
  };
}
