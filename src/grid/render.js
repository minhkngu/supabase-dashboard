import { setPage, setRows, setView } from './grid-state.js';
import { setTable } from '../metadata-state.js';
import { columnHeader, updateFrozen } from './column-header.js';
import { load } from './load.js';
export { load } from './load.js';
import { onGridAction } from '../events.js';
import { syncChrome } from '../chrome.js';
import { restoreCellFocus } from './keyboard.js';
import { renderRuleChips } from '../rule-chips.js';
import { openColumnDialog } from '../column-dialog.js';
import { rowCheckbox, rowSelectionHeader, updateRowSelection } from '../deletion.js';
import { updateHistoryButtons } from '../history.js';
import { activeLookups, lookupCell } from '../lookup.js';
import {
  isPromotionsOverview,
  promotionsOverview,
  savedOverviewMode,
  setOverviewMode,
  syncPromotionsView,
  tableOverview,
} from '../overview/mode.js';
import { openEditor } from '../record-editor.js';
import { hasRelationDisplay, nativeDisplayRows, nativeDisplayValue, nativeRelations } from '../relation-display.js';
import { closeNav, nav, tableLabel } from '../sidebar.js';
import {
  $,
  el,
  name,
  PAGE_SIZE,
  PAGE_SIZES,
  pageSize,
  savingCells,
  selectedRecords,
  setDeletionNotice,
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
  setRows([]);
  state.loadVersion++;
  state.lookupVersion++;
  setTable(t);
  clearBulk();
  const saved = state.views[name(t)] || {};
  if (
    !saved.freezeDefaultInitialized &&
    t.columns.some(c => c.name === 'name') &&
    (!Array.isArray(saved.frozen) || saved.frozen.length === 0)
  )
    saved.frozen = ['col:name'];
  saved.freezeDefaultInitialized = true;
  setView({
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
  });
  setPage(state.view.page);
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
