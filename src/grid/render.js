import { columnKind, icon } from '../icons.js';
import { PROMOTIONS_TABLE } from '../../table-config.mjs';
import { restoreCellFocus } from './keyboard.js';
import { renderRuleChips } from '../rule-chips.js';
import { openColumnMenu } from './column-menu.js';
import { api, message, toast } from '../api.js';
import { openColumnDialog } from '../column-dialog.js';
import { rowCheckbox, rowSelectionHeader, updateRowSelection } from '../deletion.js';
import { updateHistoryButtons } from '../history.js';
import { activeLookups, loadLookups, lookupCell, showLookupDialog } from '../lookup.js';
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
  openRelationDisplay,
} from '../relation-display.js';
import { closeNav, nav, tableLabel } from '../sidebar.js';
import {
  $,
  $$,
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
  setVisibleOrder,
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
    collapsed: Array.isArray(saved.collapsed) ? saved.collapsed.filter(x => typeof x === 'string') : [],
    page: Number.isSafeInteger(saved.page) && saved.page >= 0 ? Math.min(saved.page, 100000) : 0,
    pageSize: PAGE_SIZES.includes(saved.pageSize) ? saved.pageSize : PAGE_SIZE,
  };
  state.page = state.view.page;
  $('#search').value = state.view.search;
  $('#title').textContent = tableLabel(t);
  syncPromotionsView();
  $('#add').disabled = !state.configReady || !t.primary_keys?.length;
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
export async function load({ silent = false } = {}) {
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
    table = state.table;
  if (!silent) {
    if (!bulkBusy) clearBulk();
    persistView();
    message('Đang tải dữ liệu…');
    $('#grid').replaceChildren();
  }
  const filters = JSON.stringify(state.view?.filters || []),
    countKey = JSON.stringify([table.name, $('#search').value, filters]),
    needsCount = countedKey !== countKey;
  const q = new URLSearchParams({
    page: String(state.page),
    search: $('#search').value,
    orders: JSON.stringify(serverOrder()),
    filters,
  });
  if (!needsCount) q.set('count', '0');
  if (pageSize() !== PAGE_SIZE) q.set('limit', String(pageSize()));
  const cacheKey = `/api/table/${name(table)}?${q}`;
  const cached = pageCache.get(cacheKey);
  if (!silent && cached && Date.now() - cached.time < 15000) {
    state.rows = structuredClone(cached.data.rows);
    if (cached.data.total != null) state.total = cached.data.total;
    render();
    loadLookups();
    loadNativeDisplays();
    message(state.rows.length ? '' : 'Không tìm thấy bản ghi nào.');
  }
  try {
    const d = await api(cacheKey, { signal: controller.signal });
    pageCache.set(cacheKey, { time: Date.now(), data: structuredClone(d) });
    if (pageCache.size > 100) pageCache.delete(pageCache.keys().next().value);
    if (
      version !== state.loadVersion ||
      table !== state.table ||
      (silent && (state.cellEdit || state.rows.some(row => pendingRows.has(row))))
    )
      return;
    if (d.total != null) setCountedKey(countKey);
    const total = d.total ?? state.total;
    if (state.page > 0 && state.page * pageSize() >= total) {
      state.page = total ? Math.floor((total - 1) / pageSize()) : 0;
      return load({ silent });
    }
    if (silent && table.primary_keys?.length) {
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
  } catch (e) {
    if (e.name === 'AbortError' || version !== state.loadVersion || table !== state.table) return;
    if (silent || cached) toast('Không thể làm mới dữ liệu: ' + e.message);
    else {
      message(e.message, true);
      $('#count').textContent = 'Không thể tải dữ liệu';
    }
  }
}
function columnHeader(spec) {
  const c = spec.column,
    x = spec.lookup,
    th = el(
      'th',
      x
        ? 'lookup-header'
        : /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type)
          ? 'numeric'
          : '',
    );
  th.dataset.columnId = spec.id;
  if (isUuidId(c)) th.classList.add('uuid-id');
  th.draggable = true;
  th.title = 'Bấm để mở tùy chọn cột, kéo để đổi vị trí';
  th.tabIndex = 0;
  th.setAttribute('aria-haspopup', 'menu');
  th.setAttribute('aria-expanded', 'false');
  th.onclick = () => openColumnMenu(spec, th);
  th.onkeydown = e => {
    if (e.target !== th || !['Enter', ' ', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    openColumnMenu(spec, th);
  };
  const label = el('span', 'column-label');
  const kind = x ? { icon: 'lookup', label: 'Lookup' } : columnKind(c, state.table),
    typeIconEl = el('span', 'type-icon');
  typeIconEl.title = kind.label;
  typeIconEl.append(icon(kind.icon, { size: 12 }));
  label.append(typeIconEl, document.createTextNode(x ? x.label : c.name));
  const pinned = state.view.frozen.includes(spec.id),
    pin = el('button', 'column-pin');
  pin.append(icon('pin', { size: 12, filled: pinned }));
  pin.type = 'button';
  pin.title = state.view.frozen.includes(spec.id) ? 'Bỏ ghim cột' : 'Ghim cột';
  pin.setAttribute('aria-label', `${pin.title} ${x ? x.label : c.name}`);
  pin.onclick = e => {
    e.stopPropagation();
    const frozen = state.view.frozen;
    if (frozen.includes(spec.id)) state.view.frozen = frozen.filter(id => id !== spec.id);
    else frozen.push(spec.id);
    persistView();
    render();
  };
  const edit = el('button', 'column-action');
  edit.append(icon('more', { size: 14 }));
  edit.type = 'button';
  edit.setAttribute('aria-label', `Thiết lập cột ${x ? x.label : c.name}`);
  edit.title = state.adminAvailable ? 'Thiết lập cột' : state.adminError;
  edit.onclick = e => {
    e.stopPropagation();
    if (spec.lookup) {
      showLookupDialog();
      return;
    }
    openColumnDialog(spec);
  };
  const relation = spec.column ? nativeRelations().find(r => r.config.sourceColumn === spec.column.name) : null;
  if (relation) {
    const display = el('button', 'column-action', 'Aa');
    display.type = 'button';
    display.title = 'Chọn trường hiển thị';
    display.setAttribute('aria-label', `Chọn trường hiển thị ${relation.label}`);
    display.onclick = e => {
      e.stopPropagation();
      openRelationDisplay(relation);
    };
    th.append(label, display, pin, edit);
  } else th.append(label, pin, edit);
  th.ondragstart = e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-siris-column', spec.id);
    th.classList.add('column-dragging');
  };
  th.ondragend = () => {
    th.classList.remove('column-dragging');
    document.querySelectorAll('.column-drop').forEach(n => n.classList.remove('column-drop'));
  };
  th.ondragover = e => {
    if (!e.dataTransfer.types.includes('application/x-siris-column')) return;
    e.preventDefault();
    th.classList.add('column-drop');
  };
  th.ondragleave = () => th.classList.remove('column-drop');
  th.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();
    const from = e.dataTransfer.getData('application/x-siris-column'),
      to = spec.id;
    if (!from || from === to) return;
    const all = displayedColumns().map(c => c.id),
      frozen = state.view.frozen;
    if (frozen.includes(from) !== frozen.includes(to)) {
      toast('Ghim hoặc bỏ ghim cột trước khi chuyển vị trí này');
      return;
    }
    all.splice(all.indexOf(from), 1);
    let index = all.indexOf(to);
    if (e.clientX > th.getBoundingClientRect().left + th.offsetWidth / 2) index++;
    all.splice(index, 0, from);
    setVisibleOrder(all);
    persistView();
    setTimeout(render, 0);
  };
  return th;
}
function updateFrozen() {
  const grid = $('#grid');
  for (const cell of grid.querySelectorAll('.frozen-cell')) {
    cell.classList.remove('frozen-cell', 'frozen-number', 'frozen-edge');
    cell.style.left = '';
  }
  const heads = $$('thead th[data-column-id]', grid),
    frozen = state.view.frozen,
    visibleFrozen = heads.filter(head => frozen.includes(head.dataset.columnId));
  let offset = 0;
  const numberHead = grid.querySelector('thead th:first-child');
  if (numberHead) {
    offset = numberHead.offsetWidth;
    for (const cell of grid.querySelectorAll('thead th:first-child, tbody tr:not(.group-row) td:first-child')) {
      cell.classList.add('frozen-cell', 'frozen-number');
      if (!visibleFrozen.length) cell.classList.add('frozen-edge');
      cell.style.left = '0px';
    }
  }
  for (const head of heads) {
    const id = head.dataset.columnId;
    if (!frozen.includes(id)) continue;
    const index = head.cellIndex;
    for (const row of grid.rows) {
      if (row.classList.contains('group-row')) continue;
      const cell = row.cells[index];
      if (cell) {
        cell.classList.add('frozen-cell');
        if (head === visibleFrozen.at(-1)) cell.classList.add('frozen-edge');
        cell.style.left = `${offset}px`;
      }
    }
    offset += head.offsetWidth;
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
  for (const spec of columns) tr.append(columnHeader(spec));
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
          td.focus();
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
          td.focus();
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
