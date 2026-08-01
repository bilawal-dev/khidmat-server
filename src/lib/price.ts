/**
 * Parse a provider's free-text price string into a numeric range.
 *
 * Provider prices are authored as display strings like `"PKR 1500-3000"` or
 * `"PKR 3000-6000/mo"`. This pulls out the numbers so the directory can filter
 * and sort by price without the callers re-implementing the parsing.
 */
export type PriceRange = { min: number; max: number };

/**
 * Extract the low/high numbers from a price string. A single number yields an
 * equal min/max; any trailing suffix ("/mo") is ignored. Returns null when no
 * digits are present, so callers can distinguish "unpriced" from "free".
 */
export function parsePriceRange(raw: string): PriceRange | null {
  const numbers = raw.match(/\d[\d,]*/g);
  if (!numbers || numbers.length === 0) return null;

  const values = numbers.map((n) => Number(n.replace(/,/g, '')));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max };
}

/** The lowest price in a provider's range, or Infinity when it can't be parsed. */
export function minPrice(raw: string): number {
  return parsePriceRange(raw)?.min ?? Infinity;
}

/**
 * Whether a provider's range is affordable under a ceiling. A provider counts as
 * affordable when its *lowest* price is at or below the ceiling — i.e. there's a
 * tier the user can afford. Unparseable prices are excluded.
 */
export function isAffordable(raw: string, ceiling: number): boolean {
  const range = parsePriceRange(raw);
  return range !== null && range.min <= ceiling;
}
