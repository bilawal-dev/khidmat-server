import { providers, SERVICE_CATEGORIES, type ServiceCategory } from '../data/providers';
import { parsePriceRange } from './price';

/** Aggregate directory stats for one service category. */
export type CategoryStat = {
  category: ServiceCategory;
  providerCount: number;
  /** Mean provider rating, rounded to 1 dp; null when the category is empty. */
  avgRating: number | null;
  /** Cheapest entry price across the category; null when none are parseable. */
  fromPrice: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Compute the summary stats for a single category. */
export function statsForCategory(category: ServiceCategory): CategoryStat {
  const members = providers.filter((p) => p.category === category);

  const avgRating = members.length
    ? round1(members.reduce((sum, p) => sum + p.rating, 0) / members.length)
    : null;

  const entryPrices = members
    .map((p) => parsePriceRange(p.priceRange)?.min)
    .filter((n): n is number => typeof n === 'number');
  const fromPrice = entryPrices.length ? Math.min(...entryPrices) : null;

  return { category, providerCount: members.length, avgRating, fromPrice };
}

/**
 * Directory-wide breakdown: one stat entry per service category, in the
 * canonical category order. Powers a "browse by category" overview.
 */
export function categoryStats(): CategoryStat[] {
  return SERVICE_CATEGORIES.map((category) => statsForCategory(category));
}
