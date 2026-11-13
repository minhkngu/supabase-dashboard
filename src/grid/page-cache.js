import { api } from '../api.js';
import { getCacheEpoch, name, PAGE_SIZE, PAGE_SIZES, pageCache, prefetching, state } from '../state.js';
import { validFilterRules, validRules } from '../view-menus.js';

export function pageQuery(table, page, search, filters, orders, searchColumn = '', limit = PAGE_SIZE) {
  return `/api/table/${name(table)}?${new URLSearchParams({
    page: String(page),
    search,
    ...(searchColumn ? { search_column: searchColumn } : {}),
    orders: JSON.stringify(orders),
    filters: JSON.stringify(filters),
    ...(limit !== PAGE_SIZE ? { limit: String(limit) } : {}),
  })}`;
}
export function putPage(key, data) {
  pageCache.set(key, { time: Date.now(), data: structuredClone(data) });
  if (pageCache.size > 100) pageCache.delete(pageCache.keys().next().value);
}
// Loads a page the user is likely to open next; failures stay silent.
export async function prefetchPage(table, page, search, filters, orders, total, searchColumn = '', limit = PAGE_SIZE) {
  const key = pageQuery(table, page, search, filters, orders, searchColumn, limit);
  if (pageCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  const epoch = getCacheEpoch();
  try {
    const data = await api(key + (Number.isSafeInteger(total) ? '&count=none' : ''));
    if (epoch !== getCacheEpoch()) return;
    if (data.total === null) data.total = total;
    if (!Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || data.total < 0) return;
    putPage(key, data);
  } catch {
    // A prefetch that fails simply leaves the page to load normally.
  } finally {
    prefetching.delete(key);
  }
}
export function prefetchTable(table) {
  if (state.table?.name === table.name) return;
  const view = state.views[name(table)] || {},
    filters = validFilterRules(view.filters, table),
    groups = validRules(view.groups, table),
    sorts = validRules(view.sorts, table),
    seen = new Set(),
    orders = [...groups, ...sorts].filter(x => !seen.has(x.column) && seen.add(x.column));
  const searchColumn =
    view.searchColumn &&
    table.columns.some(c => c.name === view.searchColumn && ['text', 'character varying'].includes(c.data_type))
      ? view.searchColumn
      : '';
  const limit = PAGE_SIZES.includes(view.pageSize) ? view.pageSize : PAGE_SIZE;
  void prefetchPage(
    table,
    0,
    typeof view.search === 'string' && view.search.trim().length >= 2 ? view.search : '',
    filters,
    orders,
    undefined,
    searchColumn,
    limit,
  );
}
