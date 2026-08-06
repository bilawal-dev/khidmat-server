import { providers, type ServiceCategory } from '../data/providers';
import { sectorCoords } from '../data/sectors';

/** Directory coverage for a single sector that has at least one provider. */
export type SectorStat = {
  sector: string;
  coords: { lat: number; lng: number } | null;
  providerCount: number;
  /** Distinct service categories offered in this sector, in first-seen order. */
  categories: ServiceCategory[];
};

/**
 * Summarize the sectors covered by the provider directory: one entry per sector
 * that has providers, sorted by provider count (busiest first) then name. Powers
 * a "browse by area" view without the client scanning the whole provider list.
 */
export function sectorStats(): SectorStat[] {
  const bySector = new Map<string, { count: number; categories: ServiceCategory[] }>();

  for (const provider of providers) {
    const entry = bySector.get(provider.sector) ?? { count: 0, categories: [] };
    entry.count++;
    if (!entry.categories.includes(provider.category)) entry.categories.push(provider.category);
    bySector.set(provider.sector, entry);
  }

  return [...bySector.entries()]
    .map(([sector, { count, categories }]) => ({
      sector,
      coords: sectorCoords(sector) ?? null,
      providerCount: count,
      categories,
    }))
    .sort((a, b) => b.providerCount - a.providerCount || a.sector.localeCompare(b.sector));
}
