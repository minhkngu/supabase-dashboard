import { patchRow } from './grid-state.js';
import { setPage, setRows, setTotal } from './grid-state.js';
import { pageQuery, putPage, prefetchPage } from './page-cache.js';
import { gridAction } from '../events.js';
import { PROMOTIONS_TABLE } from '../../table-config.mjs';
import { api, message, toast } from '../api.js';
import { loadLookups } from '../lookup.js';
import { scheduleLookupCleanup } from '../main.js';
import { isPromotionsOverview, promotionsOverview, tableOverview } from '../overview/mode.js';
import { loadNativeDisplays } from '../relation-display.js';
import {
  $,
  getCacheEpoch,
  getCountedKey,
  getDeletionBusy,
  getDeletionTable,
  getLoadController,
  name,
  pageCache,
  pageSize,
  pendingRows,
  setCountedKey,
  setLoadController,
  state,
} from '../state.js';
import { persistView } from '../view-menus.js';
import { bulkBusy, clearBulk } from './selection.js';

function serverOrder() {
  const seen = new Set(),
    result = [];
  for (const rule of [...state.view.groups, ...state.view.sorts])
    if (!seen.has(rule.column)) {
      seen.add(rule.column);
      result.push(rule);
    }
  return result;
}
// Fetches whole-table counts for the groups visible on this page.
async function loadGroupCounts(table, version) {
  const groups = state.view.groups;
  if (!groups.length || !state.rows.length) return;
  const paths = new Map();
  for (const row of state.rows)
    for (let level = 0; level < groups.length; level++) {
      const path = groups.slice(0, level + 1).map(g => [g.column, row[g.column] ?? null]);
      if (path.some(([, value]) => value !== null && typeof value === 'object')) break;
      paths.set(JSON.stringify(path), path);
    }
  const keys = [...paths.keys()];
  const q = new URLSearchParams({
    search: $('#search').value,
    filters: JSON.stringify(state.view.filters || []),
    paths: JSON.stringify([...paths.values()]),
  });
  try {
    const { counts } = await api(`/api/table/${name(table)}/group-counts?${q}`);
    if (version !== state.loadVersion || table !== state.table) return;
    state.groupCounts = new Map();
    keys.forEach((key, i) => Number.isFinite(counts[i]) && state.groupCounts.set(key, counts[i]));
    if (!state.cellEdit) gridAction('render');
  } catch {
    // Keep the per-page counts when whole-table counts are unavailable.
  }
}
export async function load({ silent = false, skipCount = false, forceCount = false } = {}) {
  if (!state.table) return;
  if (getDeletionBusy() && getDeletionTable()?.name === state.table.name) return;
  if (isPromotionsOverview()) {
    getLoadController()?.abort();
    state.loadVersion++;
    return state.table.name === PROMOTIONS_TABLE ? promotionsOverview.load() : tableOverview.load(state.table);
  }
  getLoadController()?.abort();
  const controller = new AbortController();
  setLoadController(controller);
  const version = ++state.loadVersion,
    epoch = getCacheEpoch(),
    table = state.table;
  if (!silent) {
    if (!bulkBusy) clearBulk();
    persistView();
  }
  const search = $('#search').value,
    filters = state.view?.filters || [],
    orders = serverOrder(),
    searchColumn = $('#searchColumn')?.value || '',
    limit = pageSize(),
    countKey = JSON.stringify([table.name, search, filters, searchColumn]),
    needsCount = forceCount || (!skipCount && getCountedKey() !== countKey),
    cacheKey = pageQuery(table, state.page, search, filters, orders, searchColumn, limit),
    cached = pageCache.get(cacheKey),
    canShowCached = cached && !state.cellEdit && !state.rows.some(row => pendingRows.has(row));
  // A cached page appears immediately, even after its 60-second freshness
  // window; the network request below refreshes it in the background.
  if (canShowCached) {
    setRows(structuredClone(cached.data.rows));
    if (cached.data.total != null) setTotal(cached.data.total);
    gridAction('render');
    loadLookups();
    loadNativeDisplays();
    message(state.rows.length ? '' : 'Không tìm thấy bản ghi nào.');
  } else if (!silent) {
    message('Đang tải dữ liệu…');
    $('#grid').replaceChildren();
  }
  try {
    const d = await api(cacheKey + (needsCount ? '' : '&count=none'), { signal: controller.signal });
    if (version !== state.loadVersion || table !== state.table) return;
    // Một lần ghi xóa cache trong lúc chờ: kết quả này có thể đã cũ, nên tải
    // lại thay vì bỏ im lặng và để nguyên "Đang tải dữ liệu…".
    if (epoch !== getCacheEpoch()) return load({ silent, skipCount, forceCount });
    if (silent && (state.cellEdit || state.rows.some(row => pendingRows.has(row)))) return;
    if (!skipCount) putPage(cacheKey, d);
    if (!skipCount && d.total != null) setCountedKey(countKey);
    const total = d.total ?? state.total;
    if (state.page > 0 && state.page * limit >= total) {
      setPage(total ? Math.floor((total - 1) / limit) : 0);
      return load({ silent });
    }
    if ((silent || canShowCached) && table.primary_keys?.length) {
      const key = row => JSON.stringify(table.primary_keys.map(k => row[k])),
        existing = new Map(state.rows.map(row => [key(row), row]));
      setRows(
        d.rows.map(row => {
          const old = existing.get(key(row));
          return old ? patchRow(old, row) : row;
        }),
      );
    } else setRows(d.rows);
    setTotal(total);
    state.initialRowsReady = true;
    state.groupCounts = null;
    void loadGroupCounts(table, version);
    gridAction('render');
    scheduleLookupCleanup();
    loadLookups();
    loadNativeDisplays();
    message(d.rows.length ? '' : 'Không tìm thấy bản ghi nào.');
    if (!skipCount && (state.page + 1) * limit < total)
      void prefetchPage(table, state.page + 1, search, state.view?.filters || [], orders, total, searchColumn, limit);
  } catch (e) {
    if (e.name === 'AbortError' || version !== state.loadVersion || table !== state.table) return;
    if (silent || cached) toast('Không thể làm mới dữ liệu: ' + e.message);
    else {
      message(e.message, true);
      $('#count').textContent = 'Không thể tải dữ liệu';
    }
  }
}
