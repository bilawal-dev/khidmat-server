/**
 * Tiny, generic offset/limit pagination over an in-memory array. Endpoints that
 * already build a full result set (the seed data is small) can slice it for the
 * client and report enough metadata to drive "load more" without re-querying.
 */
export type Page<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number | null;
  hasMore: boolean;
};

export type PaginateOptions = {
  /** Items to skip from the front. Negative values are clamped to 0. */
  offset?: number;
  /** Max items to return. Omitted/non-positive means "all remaining". */
  limit?: number;
};

export function paginate<T>(all: T[], options: PaginateOptions = {}): Page<T> {
  const total = all.length;
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const hasLimit = typeof options.limit === 'number' && options.limit > 0;
  const limit = hasLimit ? Math.floor(options.limit as number) : null;

  const items = limit === null ? all.slice(offset) : all.slice(offset, offset + limit);
  const hasMore = offset + items.length < total;

  return { items, total, offset, limit, hasMore };
}
