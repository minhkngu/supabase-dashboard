import { columnHeader, updateFrozen } from './column-header.js';
import { pageQuery, putPage, prefetchPage } from './page-cache.js';
import { onGridAction } from '../events.js';
import { syncChrome } from '../chrome.js';
import { PROMOTIONS_TABLE } from '../../table-config.mjs';
import { restoreCellFocus } from './keyboard.js';
import { renderRuleChips } from '../rule-chips.js';
import { api, message, toast } from '../api.js';
import { openColumnDialog } from '../column-dialog.js';
import { rowCheckbox, rowSelectionHeader, updateRowSelection } from '../deletion.js';
import { updateHistoryButtons } from '../history.js';
import { activeLookups, loadLookups, lookupCell } from '../lookup.js';
import { scheduleLookupCleanup } from '../main.js';
import {
  isPromotionsOverview,
  promotionsOverview,
  savedOverviewMode,
  setOverviewMode,
  syncPromotionsView,
  tableOverview,
} from '../overview/mode.js';
import { openEditor } from '../record-editor.js';
import {
  hasRelationDisplay,
  loadNativeDisplays,
  nativeDisplayRows,
  nativeDisplayValue,
  nativeRelations,
} from '../relation-display.js';
import { closeNav, nav, tableLabel } from '../sidebar.js';
import {
  $,
  cacheEpoch,
  countedKey,
  deletionBusy,
  deletionTable,
  el,
  loadController,
  name,
  PAGE_SIZE,
  PAGE_SIZES,
  pageCache,
  pageSize,
  pendingRows,
  savingCells,
  selectedRecords,
  setCountedKey,
  setDeletionNotice,
  setLoadController,
  state,
} from '../state.js';
import {
  closeViewMenus,
  displayedColumns,
  isUuidId,
  persistView,
  renderViewMenu,
  validFilterRules,
  validRules,
} from '../view-menus.js';
import { editableCell, formatNumber } from './cell-edit.js';
import {
  bulkBusy,
  clearBulk,
  dragSelection,
  pasteFromCell,
  selectBulk,
  selectedCells,
  setCopySelection,
  setDragSelection,
  syncGrid,
} from './selection.js';

export function choose(t) {
  selectedRecords.clear();
  setDeletionNotice('');
  promotionsOverview.cancel();
  tableOverview.cancel();
  setOverviewMode(savedOverviewMode(t));
  state.rows = [];
  state.loadVersion++;
  state.lookupVersion++;
  state.table = t;
  clearBulk();
  const saved = state.views[name(t)] || {};
  if (
    !saved.freezeDefaultInitialized &&
    t.columns.some(c => c.name === 'name') &&
    (!Array.isArray(saved.frozen) || saved.frozen.length === 0)
  )
    saved.frozen = ['col:name'];
  saved.freezeDefaultInitialized = true;
  state.view = {
    filters: validFilterRules(saved.filters, t),
    groups: validRules(saved.groups, t),
    sorts: validRules(saved.sorts, t),
    order: Array.isArray(saved.order) ? saved.order.filter(x => typeof x === 'string') : [],
    widths: saved.widths && typeof saved.widths === 'object' ? saved.widths : {},
    hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(x => typeof x === 'string') : [],
    frozen: Array.isArray(saved.frozen)
      ? saved.frozen.filter(x => typeof x === 'string')
      : t.columns.some(c => c.name === 'name')
        ? ['col:name']
        : [],
    search: typeof saved.search === 'string' ? saved.search : '',
    searchColumn: typeof saved.searchColumn === 'string' ? saved.searchColumn : '',
    collapsed: Array.isArray(saved.collapsed) ? saved.collapsed.filter(x => typeof x === 'string') : [],
    page: Number.isSafeInteger(saved.page) && saved.page >= 0 ? Math.min(saved.page, 100000) : 0,
    pageSize: PAGE_SIZES.includes(saved.pageSize) ? saved.pageSize : PAGE_SIZE,
  };
  state.page = state.view.page;
  $('#search').value = state.view.search;
  const searchColumn = $('#searchColumn');
  searchColumn.replaceChildren(
    new Option('Mọi cột văn bản', ''),
    ...t.columns.filter(c => ['text', 'character varying'].includes(c.data_type)).map(c => new Option(c.name, c.name)),
  );
  searchColumn.value = state.view.searchColumn;
  state.view.searchColumn = searchColumn.value;
  $('#title').textContent = tableLabel(t);
  syncPromotionsView();
  syncChrome();
  updateHistoryButtons();
  state.lookupResults = new Map();
  state.collapsed = new Set(state.view.collapsed);
  closeViewMenus();
  renderViewMenu('filter');
  renderViewMenu('group');
  renderViewMenu('sort');
  persistView();
  nav();
  closeNav();
  load();
}
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
    if (!state.cellEdit) render();
  } catch {
    // Keep the per-page counts when whole-table counts are unavailable.
  }
}
export async function load({ silent = false, skipCount = false, forceCount = false } = {}) {
  if (!state.table) return;
  if (deletionBusy && deletionTable?.name === state.table.name) return;
  if (isPromotionsOverview()) {
    loadController?.abort();
    state.loadVersion++;
    return state.table.name === PROMOTIONS_TABLE ? promotionsOverview.load() : tableOverview.load(state.table);
  }
  loadController?.abort();
  const controller = new AbortController();
  setLoadController(controller);
  const version = ++state.loadVersion,
    epoch = cacheEpoch,
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
    needsCount = forceCount || (!skipCount && countedKey !== countKey),
    cacheKey = pageQuery(table, state.page, search, filters, orders, searchColumn, limit),
    cached = pageCache.get(cacheKey),
    canShowCached = cached && !state.cellEdit && !state.rows.some(row => pendingRows.has(row));
  // A cached page appears immediately, even after its 60-second freshness
  // window; the network request below refreshes it in the background.
  if (canShowCached) {
    state.rows = structuredClone(cached.data.rows);
    if (cached.data.total != null) state.total = cached.data.total;
    render();
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
    if (epoch !== cacheEpoch) return load({ silent, skipCount, forceCount });
    if (silent && (state.cellEdit || state.rows.some(row => pendingRows.has(row)))) return;
    if (!skipCount) putPage(cacheKey, d);
    if (!skipCount && d.total != null) setCountedKey(countKey);
    const total = d.total ?? state.total;
    if (state.page > 0 && state.page * limit >= total) {
      state.page = total ? Math.floor((total - 1) / limit) : 0;
      return load({ silent });
    }
    if ((silent || canShowCached) && table.primary_keys?.length) {
      const key = row => JSON.stringify(table.primary_keys.map(k => row[k])),
        existing = new Map(state.rows.map(row => [key(row), row]));
      state.rows = d.rows.map(row => {
        const old = existing.get(key(row));
        return old ? Object.assign(old, row) : row;
      });
    } else state.rows = d.rows;
    state.total = total;
    state.initialRowsReady = true;
    state.groupCounts = null;
    void loadGroupCounts(table, version);
    render();
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
export function render() {
  if (!state.table || !state.view) return;
  syncPromotionsView();
  updateRowSelection();
  if (isPromotionsOverview()) return;
  const liveGrid = $('#grid'),
    grid = document.createElement('table');
  const columns = displayedColumns(),
    head = el('thead'),
    tr = el('tr');
  tr.append(rowSelectionHeader());
  for (const spec of columns) tr.append(columnHeader(spec, render));
  const addHeader = el('th', 'add-column-header'),
    addColumn = el('button', 'add-column', '＋');
  addColumn.type = 'button';
  addColumn.setAttribute('aria-label', 'Thêm cột');
  addColumn.title = 'Thêm vào bảng';
  addColumn.onclick = () => openColumnDialog();
  addHeader.append(addColumn);
  tr.append(addHeader);
  head.append(tr);
  grid.append(head);
  const body = el('tbody'),
    rows = state.rows.map((row, i) => ({ row, i })),
    groups = state.view.groups;
  let previous = [];
  rows.forEach(({ row, i }) => {
    const path = groups.map(g => row[g.column]);
    let hidden = false;
    for (let level = 0; level < groups.length; level++) {
      const prefix = path.slice(0, level + 1),
        key = JSON.stringify(prefix.map((v, j) => [groups[j].column, v]));
      const changed =
        level >= previous.length || prefix.some((v, j) => JSON.stringify(v) !== JSON.stringify(previous[j]));
      if (changed && !hidden) {
        const count = rows.filter(x =>
          prefix.every((v, j) => JSON.stringify(x.row[groups[j].column]) === JSON.stringify(v)),
        ).length;
        const gr = el('tr', 'group-row'),
          cell = el('td');
        gr.dataset.renderKey = 'group:' + key;
        cell.colSpan = columns.length + 2;
        const toggle = el('button', 'group-toggle');
        toggle.style.paddingLeft = `${level * 18}px`;
        const closed = state.collapsed.has(key);
        toggle.setAttribute('aria-expanded', String(!closed));
        const grCol = groups[level] && state.table.columns.find(c => c.name === groups[level].column);
        const grIsNum =
          grCol && /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(grCol.data_type);
        const value = path[level],
          display = nativeDisplayValue(groups[level].column, value),
          label = display
            ? display.text
            : value == null
              ? nativeRelations().some(
                  rel => rel.config.sourceColumn === groups[level].column && hasRelationDisplay(rel),
                )
                ? '—'
                : 'null'
              : grIsNum
                ? formatNumber(value)
                : String(value);
        toggle.setAttribute('aria-label', `${groups[level].column}: ${label}`);
        toggle.append(
          el('span', 'group-arrow', closed ? '▸' : '▾'),
          el('span', 'group-label', label),
          el(
            'span',
            'group-count',
            state.groupCounts?.has(key)
              ? `${formatNumber(state.groupCounts.get(key))} bản ghi`
              : `${formatNumber(count)} trên trang`,
          ),
        );
        toggle.onclick = () => {
          if (state.collapsed.has(key)) state.collapsed.delete(key);
          else state.collapsed.add(key);
          persistView();
          render();
        };
        cell.append(toggle);
        gr.append(cell);
        body.append(gr);
      }
      if (state.collapsed.has(key)) hidden = true;
    }
    previous = path;
    if (hidden) return;
    const r = el('tr');
    r.dataset.renderKey =
      'row:' + JSON.stringify(state.table.primary_keys?.length ? state.table.primary_keys.map(k => row[k]) : [i]);
    r.tabIndex = 0;
    r.setAttribute('aria-label', `Mở bản ghi ${state.page * pageSize() + i + 1}`);
    const rowNumber = formatNumber(state.page * pageSize() + i + 1),
      detailCell = el('td', 'record-detail');
    detailCell.title = 'Mở chi tiết bản ghi';
    const indexLabel = el('span', 'record-index', rowNumber);
    detailCell.append(rowCheckbox(row, i), indexLabel);
    r.append(detailCell);
    for (const spec of columns) {
      if (spec.lookup) {
        const td = lookupCell(spec.lookup, row);
        td.dataset.bulkRow = String(i);
        td.dataset.bulkColumn = spec.id;
        td.dataset.bulkVirtual = 'true';
        td.tabIndex = 0;
        td.setAttribute('aria-label', `${spec.lookup.label}: ${td.textContent || 'trống'}, chỉ đọc`);
        r.append(td);
        continue;
      }
      const c = spec.column,
        v = row[c.name],
        isNum = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type),
        td = el('td', isNum ? 'numeric' : '');
      if (v === null || v === undefined) {
        const synced = activeLookups().some(x => x.sync?.columnName === c.name);
        if (!synced) td.append(el('span', 'null', '—'));
      } else if (typeof v === 'boolean')
        td.append(el('span', `boolean ${v ? 'is-true' : 'is-false'}`, v ? 'true' : 'false'));
      else {
        const str = typeof v === 'object' ? JSON.stringify(v) : isNum ? formatNumber(v) : String(v);
        td.textContent = str;
        td.title = str;
      }
      const native = nativeRelations().find(rel => rel.config.sourceColumn === c.name && hasRelationDisplay(rel)),
        display = nativeDisplayValue(c.name, v);
      if (display) {
        td.textContent = display.text;
        td.title = String(v);
      } else if (native && v != null && nativeDisplayRows.get(native.id) === null)
        td.title = 'Không thể tải tên liên kết';
      editableCell(td, row, c);
      td.dataset.bulkRow = String(i);
      td.dataset.bulkColumn = c.name;
      if (isUuidId(c)) td.classList.add('uuid-id');
      if (savingCells.get(row)?.has(c.name)) {
        td.classList.add('cell-saving');
        td.setAttribute('aria-busy', 'true');
      }
      td.onpaste = e => {
        const text = e.clipboardData?.getData('text/plain');
        if (text === undefined || text === '' || bulkBusy) return;
        const isEditor = e.target !== td;
        if (isEditor && !/[\r\n\t]/.test(text)) return;
        e.preventDefault();
        e.stopPropagation();
        if (isEditor) {
          const edit = state.cellEdit;
          if (!edit || edit.td !== td || edit.saving) return;
          edit.cancelled = true;
          state.cellEdit = null;
          render();
        }
        void pasteFromCell(td.dataset.bulkRow, td.dataset.bulkColumn, text);
      };
      const ordinaryClick = td.onclick;
      td.onclick = e => {
        if (dragSelection?.moved) {
          e.preventDefault();
          e.stopPropagation();
          setDragSelection(null);
          td.focus({ preventScroll: true });
          return;
        }
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          selectBulk(td, i, c);
          setCopySelection(
            selectedCells.length
              ? selectedCells.map(rowIndex => [
                  document.querySelector(
                    `#grid td[data-bulk-row="${rowIndex}"][data-bulk-column="${CSS.escape(c.name)}"]`,
                  ),
                ])
              : [[td]],
          );
          td.focus({ preventScroll: true });
        } else {
          clearBulk();
          ordinaryClick(e);
        }
      };
      r.append(td);
    }
    r.append(el('td', 'add-column-cell'));
    r.onclick = () => openEditor(row);
    r.onkeydown = e => {
      if (e.key === 'Enter' && !e.target.closest('input,button')) openEditor(row);
    };
    body.append(r);
  });
  grid.append(body);
  syncGrid(liveGrid, grid);
  restoreCellFocus();
  renderRuleChips();
  updateRowSelection();
  $('#hiddenColumnCount').textContent = state.view.hidden.length ? String(state.view.hidden.length) : '';
  $('#count').textContent = `${formatNumber(state.total)} bản ghi`;
  $('#page').textContent = `Trang ${formatNumber(state.page + 1)}`;
  $('#prev').disabled = state.page === 0;
  $('#next').disabled = (state.page + 1) * pageSize() >= state.total;
  if ($('#pageSize').value !== String(pageSize())) {
    $('#pageSize').value = String(pageSize());
    $('#pageSize')._syncColumnSelect?.();
  }
  requestAnimationFrame(() => {
    if (liveGrid.isConnected && state.table) updateFrozen();
  });
}

// Đăng ký sau khi các module được nạp; hàm vẫn giữ kết quả Promise cho nơi gọi.
onGridAction((action, value) => {
  if (action === 'load') return load(value);
  if (action === 'render') return render();
  if (action === 'choose') return choose(value);
});
