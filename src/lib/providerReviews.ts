import type { Provider } from '../data/providers';

/**
 * Deterministic mock reviews for a provider. There's no review store, so we
 * synthesize a stable star-distribution and a few sample snippets from the
 * provider's own rating/reviewCount — deterministic so the same provider always
 * yields the same "reviews" across requests (no Math.random).
 */
export type RatingBreakdown = { stars: 1 | 2 | 3 | 4 | 5; count: number };

export type ProviderReviews = {
  average: number;
  total: number;
  breakdown: RatingBreakdown[];
  samples: string[];
};

const SNIPPETS = [
  'Prompt and professional — would book again.',
  'Fair pricing and tidy work.',
  'Arrived on time and fixed it quickly.',
  'Courteous and knew exactly what to do.',
  'Good communication throughout.',
];

/**
 * Spread `total` reviews across 1–5 stars, weighted toward the provider's
 * average so the distribution looks plausible and always sums to `total`.
 */
function distribute(total: number, average: number): RatingBreakdown[] {
  const weights = [1, 2, 3, 4, 5].map((stars) => {
    // Closer to the average → higher weight; keep a small floor for realism.
    const closeness = 1 / (1 + Math.abs(stars - average));
    return closeness * closeness;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const counts = weights.map((w) => Math.round((w / weightSum) * total));
  // Fix rounding drift by adjusting the modal (highest-weight) bucket.
  const drift = total - counts.reduce((a, b) => a + b, 0);
  const modal = weights.indexOf(Math.max(...weights));
  counts[modal] += drift;

  return counts.map((count, i) => ({ stars: (i + 1) as RatingBreakdown['stars'], count }));
}

/** Build the deterministic review summary for a provider. */
export function providerReviews(provider: Provider): ProviderReviews {
  const total = provider.reviewCount;
  // Rotate the snippet list by the numeric part of the id so it's stable but varied.
  const seed = Number(provider.id.replace(/\D/g, '')) || 0;
  const samples = [0, 1, 2].map((i) => SNIPPETS[(seed + i) % SNIPPETS.length]);

  return {
    average: provider.rating,
    total,
    breakdown: distribute(total, provider.rating),
    samples,
  };
}
