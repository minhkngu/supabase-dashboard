import { onDataChanged } from '../events.js';

export const pageCache = new Map();
export const prefetching = new Set();
// Bumped whenever a write clears the page cache; a prefetch started before the
// write must not put stale rows back.
let cacheEpoch = 0;
// Lookup results by (source table, key column, fields, value), kept for 60s.
export const lookupCache = new Map();
export function invalidateLookupCache(table) {
  if (!table) {
    lookupCache.clear();
    return;
  }
  for (const [key, group] of lookupCache) if (group.table === table) lookupCache.delete(key);
}
// Key (table, search, filters) whose total row count is already known; page
// changes within it skip the count query. Any write clears it with the cache.
let countedKey = null;
export function clearPageCache() {
  pageCache.clear();
  prefetching.clear();
  countedKey = null;
  cacheEpoch++;
}
let loadController = null;
export function setLoadController(value) {
  return (loadController = value);
}

export function setCountedKey(value) {
  return (countedKey = value);
}

onDataChanged(table => {
  clearPageCache();
  invalidateLookupCache(table);
});

export const getCacheEpoch = () => cacheEpoch;
export const getCountedKey = () => countedKey;
export const getLoadController = () => loadController;
