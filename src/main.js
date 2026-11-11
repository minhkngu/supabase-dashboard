import { api, message, toast } from './api.js';
import { openColumnDialog } from './column-dialog.js';
import { createCustomSelect } from './custom-select.js';
import { deleteRecords, refreshAfterWrite, rowCheckbox, rowSelectionHeader, updateRowSelection } from './deletion.js';
import { editableCell, formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { historyFor, updateHistoryButtons } from './history.js';
import {
  activeLookups,
  loadLookups,
  lookupCell,
  restoreLookups,
  setLookupCloudAvailable,
  showLookupDialog,
} from './lookup.js';
import {
  isPromotionsOverview,
  promotionsOverview,
  savedPromotionsMode,
  setPromotionsMode,
  syncPromotionsView,
  tableOverview,
} from './overview/mode.js';
import {
  displaySettingKey,
  loadNativeDisplays,
  nativeDisplayRows,
  nativeDisplayValue,
  nativeRelations,
  openRelationDisplay,
  relationDisplaySettings,
} from './relation-display.js';
import { closeNav, nav, restoreSidebar } from './sidebar.js';
import {
  $,
  countedKey,
  deletionBusy,
  deletionTable,
  el,
  loadController,
  name,
  pageCache,
  pendingRows,
  selectedRecords,
  setCountedKey,
  setDeletionNotice,
  setLoadController,
  state,
  writable,
} from './state.js';
import {
  closeViewMenus,
  displayedColumns,
  persistView,
  renderViewMenu,
  restoreViews,
  setVisibleOrder,
  validFilterRules,
  validRules,
} from './view-menus.js';

export function choose(t) {
  selectedRecords.clear();
  setDeletionNotice('');
  promotionsOverview.cancel();
  tableOverview.cancel();
  setPromotionsMode(savedPromotionsMode(t));
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
  };
  state.page = state.view.page;
  $('#search').value = state.view.search;
  $('#title').textContent = name(t);
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
export async function load({ silent = false } = {}) {
  if (!state.table) return;
  if (deletionBusy && deletionTable?.name === state.table.name) return;
  if (isPromotionsOverview()) {
    loadController?.abort();
    state.loadVersion++;
    return state.table.name === 'public.promotions' ? promotionsOverview.load() : tableOverview.load(state.table);
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
    page: state.page,
    search: $('#search').value,
    orders: JSON.stringify(serverOrder()),
    filters,
  });
  if (!needsCount) q.set('count', '0');
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
    if (state.page > 0 && state.page * 50 >= total) {
      state.page = total ? Math.floor((total - 1) / 50) : 0;
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
  th.draggable = true;
  th.title = 'Kéo để đổi vị trí cột';
  const label = el('span', 'column-label');
  label.append(el('span', 'type-icon', x ? '↗' : typeIcon(c)), document.createTextNode(x ? x.label : c.name));
  const pin = el('button', 'column-pin', state.view.frozen.includes(spec.id) ? '◆' : '◇');
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
  const edit = el('button', 'column-action', '⋯');
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
  const heads = [...grid.querySelectorAll('thead th[data-column-id]')],
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
                  rel =>
                    rel.config.sourceColumn === groups[level].column && relationDisplaySettings[displaySettingKey(rel)],
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
          el('span', 'group-count', `${formatNumber(count)} trên trang`),
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
    r.setAttribute('aria-label', `Mở bản ghi ${state.page * 50 + i + 1}`);
    const rowNumber = formatNumber(state.page * 50 + i + 1),
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
      const native = nativeRelations().find(
          rel => rel.config.sourceColumn === c.name && relationDisplaySettings[displaySettingKey(rel)],
        ),
        display = nativeDisplayValue(c.name, v);
      if (display) {
        td.textContent = display.text;
        td.title = String(v);
      } else if (native && v != null && nativeDisplayRows.get(native.id) === null)
        td.title = 'Không thể tải tên liên kết';
      editableCell(td, row, c);
      td.dataset.bulkRow = String(i);
      td.dataset.bulkColumn = c.name;
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
          dragSelection = null;
          td.focus();
          return;
        }
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          selectBulk(td, i, c);
          copySelection = selectedCells.length
            ? selectedCells.map(rowIndex => [
                document.querySelector(
                  `#grid td[data-bulk-row="${rowIndex}"][data-bulk-column="${CSS.escape(c.name)}"]`,
                ),
              ])
            : [[td]];
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
  updateRowSelection();
  $('#hiddenColumnCount').textContent = state.view.hidden.length ? String(state.view.hidden.length) : '';
  $('#count').textContent = `${formatNumber(state.total)} bản ghi`;
  $('#page').textContent = `Trang ${formatNumber(state.page + 1)}`;
  $('#prev').disabled = state.page === 0;
  $('#next').disabled = (state.page + 1) * 50 >= state.total;
  requestAnimationFrame(() => {
    if (liveGrid.isConnected && state.table) updateFrozen();
  });
}

export let selectionAnchor = null,
  selectedCells = [],
  bulkBusy = false,
  dragSelection = null,
  copySelection = [],
  virtualAnchor = null;
function syncGrid(live, next) {
  const oldHead = live.tHead,
    newHead = next.tHead;
  if (!oldHead || oldHead.innerHTML !== newHead.innerHTML) {
    if (oldHead) oldHead.replaceWith(newHead);
    else live.append(newHead);
  }
  let body = live.tBodies[0];
  const incoming = next.tBodies[0];
  if (!body) {
    live.append(incoming);
    return;
  }
  const existing = new Map([...body.rows].map(row => [row.dataset.renderKey, row]));
  let position = body.firstElementChild;
  for (const fresh of [...incoming.rows]) {
    let current = existing.get(fresh.dataset.renderKey);
    if (current) {
      existing.delete(fresh.dataset.renderKey);
      const before = [...current.cells],
        after = [...fresh.cells];
      if (before.length !== after.length) {
        if (position === current) position = fresh;
        current.replaceWith(fresh);
        current = fresh;
      } else
        for (let i = 0; i < after.length; i++) {
          const old = before[i],
            cell = after[i],
            oldClass = [...old.classList]
              .filter(c => !['bulk-selected', 'frozen-cell', 'frozen-number', 'frozen-edge'].includes(c))
              .sort()
              .join(' '),
            newClass = [...cell.classList].sort().join(' ');
          if (
            old.innerHTML === cell.innerHTML &&
            oldClass === newClass &&
            old.title === cell.title &&
            old.colSpan === cell.colSpan &&
            old.dataset.bulkRow === cell.dataset.bulkRow &&
            old.dataset.bulkColumn === cell.dataset.bulkColumn
          )
            continue;
          if (old.classList.contains('bulk-selected')) cell.classList.add('bulk-selected');
          const focused = document.activeElement === old;
          copySelection = copySelection.map(row => row.map(item => (item === old ? cell : item)));
          if (virtualAnchor === old) virtualAnchor = cell;
          old.replaceWith(cell);
          if (focused) cell.focus();
        }
    } else current = fresh;
    if (current !== position) body.insertBefore(current, position);
    position = current.nextElementSibling;
  }
  for (const row of existing.values()) row.remove();
}

function batchWritable(c, table = state.table) {
  return !!(
    c &&
    table?.primary_keys?.length &&
    writable(c) &&
    !table.primary_keys.includes(c.name) &&
    !nativeRelations(table).some(r => r.config.sourceColumn === c.name)
  );
}
export function clearBulk() {
  selectionAnchor = null;
  virtualAnchor = null;
  selectedCells = [];
  copySelection = [];
  document.querySelectorAll('#grid .bulk-selected').forEach(td => td.classList.remove('bulk-selected'));
  $('#bulkBar').hidden = true;
  $('#bulkError').textContent = '';
}
function selectBulk(td, row, c, deferEditor = false) {
  if (bulkBusy || !batchWritable(c)) return;
  const cells = [...document.querySelectorAll('#grid td[data-bulk-column]')].filter(
    x => x.dataset.bulkColumn === c.name,
  );
  if (
    !selectionAnchor ||
    selectionAnchor.column !== c.name ||
    !cells.some(x => Number(x.dataset.bulkRow) === selectionAnchor.row)
  ) {
    clearBulk();
    selectionAnchor = { column: c.name, row };
    td.classList.add('bulk-selected');
    return;
  }
  const first = cells.findIndex(x => Number(x.dataset.bulkRow) === selectionAnchor.row),
    last = cells.indexOf(td);
  if (last < 0) return;
  selectedCells = cells.slice(Math.min(first, last), Math.max(first, last) + 1).map(x => Number(x.dataset.bulkRow));
  document.querySelectorAll('#grid .bulk-selected').forEach(x => x.classList.remove('bulk-selected'));
  for (const x of cells) if (selectedCells.includes(Number(x.dataset.bulkRow))) x.classList.add('bulk-selected');
  if (selectedCells.length < 2 || deferEditor) {
    $('#bulkBar').hidden = true;
    return;
  }
  $('#bulkLabel').textContent = `${c.name} · ${selectedCells.length} ô`;
  const input = el(c.data_type === 'boolean' ? 'select' : 'input');
  input.id = 'bulkValue';
  input.setAttribute('aria-label', 'Giá trị sửa hàng loạt');
  if (c.data_type === 'boolean') {
    if (c.options.includes('nullable')) input.add(new Option('[null]', ''));
    input.add(new Option('true', 'true'));
    input.add(new Option('false', 'false'));
  } else input.placeholder = 'Giá trị mới';
  $('#bulkField').replaceChildren(input);
  $('#bulkError').textContent = '';
  $('#bulkApply').disabled = false;
  $('#bulkBar').hidden = false;
}
function selectRectangle(first, last, deferEditor = false) {
  const rows = [...document.querySelectorAll('#grid tbody tr:not(.group-row)')],
    startRow = rows.indexOf(first.parentElement),
    endRow = rows.indexOf(last.parentElement);
  if (startRow < 0 || endRow < 0) return;
  const lo = Math.min(first.cellIndex, last.cellIndex),
    hi = Math.max(first.cellIndex, last.cellIndex),
    chosen = rows.slice(Math.min(startRow, endRow), Math.max(startRow, endRow) + 1);
  clearBulk();
  copySelection = chosen.map(row => [...row.cells].slice(lo, hi + 1));
  for (const row of copySelection) for (const cell of row) cell.classList.add('bulk-selected');
  if (
    lo === hi &&
    !first.dataset.bulkVirtual &&
    first.dataset.bulkColumn &&
    first.dataset.bulkColumn === last.dataset.bulkColumn
  ) {
    const column = state.table.columns.find(c => c.name === first.dataset.bulkColumn);
    selectBulk(first, Number(first.dataset.bulkRow), column, deferEditor);
    selectBulk(last, Number(last.dataset.bulkRow), column, deferEditor);
    copySelection = chosen.map(row => [row.cells[lo]]);
  }
}
const gridSelection = $('#grid');
export function initMain() {
  gridSelection.addEventListener(
    'click',
    event => {
      const cell = event.target.closest('td[data-bulk-virtual]');
      if (!cell) return;
      if (dragSelection?.moved) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cell.focus();
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!virtualAnchor || !virtualAnchor.isConnected) {
          clearBulk();
          virtualAnchor = cell;
          cell.classList.add('bulk-selected');
          copySelection = [[cell]];
        } else {
          const anchor = virtualAnchor;
          selectRectangle(anchor, cell);
          virtualAnchor = anchor;
        }
        cell.focus();
      } else if (!event.target.closest('button')) {
        clearBulk();
        virtualAnchor = cell;
        cell.classList.add('bulk-selected');
        copySelection = [[cell]];
        cell.focus();
      }
    },
    true,
  );
  gridSelection.addEventListener('mousedown', event => {
    const cell = event.target.closest('td[data-bulk-column]');
    if (
      event.button !== 0 ||
      !cell ||
      event.shiftKey ||
      event.target.closest('input,select,textarea') ||
      (event.target.closest('button') && !event.target.closest('button.lookup-link'))
    )
      return;
    event.preventDefault();
    dragSelection = { first: cell, last: cell, moved: false };
  });
  gridSelection.addEventListener('dragstart', event => {
    if (event.target.closest('td[data-bulk-column]')) event.preventDefault();
  });
  gridSelection.addEventListener('mouseover', event => {
    const cell = event.target.closest('td[data-bulk-column]');
    if (!dragSelection || !cell || !(event.buttons & 1) || cell === dragSelection.last) return;
    dragSelection.moved = true;
    dragSelection.last = cell;
    selectRectangle(dragSelection.first, cell, true);
  });
  document.addEventListener('mouseup', () => {
    if (dragSelection?.moved) {
      const cell = dragSelection.last;
      selectRectangle(dragSelection.first, cell);
      cell.focus();
      setTimeout(() => {
        dragSelection = null;
      }, 0);
    } else dragSelection = null;
  });
  document.addEventListener('copy', event => {
    if (
      !copySelection.length ||
      !event.clipboardData ||
      !document.activeElement?.closest('#grid') ||
      document.activeElement.closest('input,textarea,select,[contenteditable=true]')
    )
      return;
    const text = copySelection
      .map(row =>
        row
          .map(cell => {
            const index = Number(cell.dataset.bulkRow),
              column = cell.dataset.bulkColumn,
              value = cell.dataset.bulkVirtual
                ? [...cell.querySelectorAll('.lookup-link')].map(button => button.textContent).join(', ') ||
                  (cell.textContent === '—' || cell.textContent === 'Đang tải…' ? '' : cell.textContent)
                : column
                  ? state.rows[index]?.[column]
                  : cell.textContent;
            return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
          })
          .join('\t'),
      )
      .join('\n');
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    toast('Đã sao chép vùng chọn');
  });
  document.addEventListener('keydown', async event => {
    if (
      !['Delete', 'Backspace'].includes(event.key) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      bulkBusy ||
      state.cellEdit ||
      !copySelection.length ||
      !document.activeElement?.closest('#grid') ||
      event.target.closest('input,textarea,select,[contenteditable=true]')
    )
      return;
    event.preventDefault();
    const selection = copySelection.map(row => row.slice()),
      first = selection[0]?.[0],
      columns = displayedColumns(),
      start = columns.findIndex(spec => spec.column?.name === first?.dataset.bulkColumn);
    if (start < 0 || selection.some(row => row.some(cell => cell.dataset.bulkVirtual || !cell.dataset.bulkColumn))) {
      toast('Vùng chọn có cột chỉ đọc hoặc không thể xóa.');
      return;
    }
    const indexes = selection.map(row => Number(row[0].dataset.bulkRow));
    bulkBusy = true;
    try {
      await pasteCells(
        start,
        indexes[0],
        selection.map(row => row.map(() => '')),
        indexes,
        { clear: true },
      );
      clearBulk();
    } catch (error) {
      toast(error.message);
      if (!$('#bulkBar').hidden) $('#bulkError').textContent = error.message;
    } finally {
      bulkBusy = false;
    }
  });
  $('#bulkCancel').onclick = () => clearBulk();
  $('#bulkBar').onsubmit = async e => {
    e.preventDefault();
    if (bulkBusy || selectedCells.length < 2) return;
    const c = displayedColumns().findIndex(s => s.column?.name === selectionAnchor?.column),
      rows = selectedCells.slice(),
      value = $('#bulkValue').value;
    bulkBusy = true;
    $('#bulkApply').disabled = true;
    $('#bulkError').textContent = 'Đang lưu…';
    try {
      await pasteCells(
        c,
        rows[0],
        rows.map(() => [value]),
        rows,
      );
      clearBulk();
    } catch (error) {
      selectedCells = [];
      selectionAnchor = null;
      $('#bulkError').textContent = error.message;
      $('#bulkBar').hidden = false;
    } finally {
      bulkBusy = false;
      $('#bulkApply').disabled = selectedCells.length < 2;
    }
  };
  $('#form').onsubmit = async e => {
    e.preventDefault();
    if (deletionBusy || !state.configReady) return;
    $('#formError').textContent = '';
    try {
      const values = {};
      for (const input of document.querySelectorAll('#formFields [data-column]')) {
        if (input.disabled) continue;
        const c = state.table.columns.find(c => c.name === input.dataset.column);
        if (state.edit && input.value === input.dataset.original) continue;
        if (!state.edit && input.value === '' && (c.default_value || c.options.includes('identity'))) continue;
        values[c.name] = valueFor(c, input.value);
      }
      if (state.edit && !Object.keys(values).length) {
        $('#editor').close();
        return;
      }
      const key = state.edit ? Object.fromEntries(state.table.primary_keys.map(k => [k, state.edit[k]])) : undefined;
      if (state.edit && !state.table.primary_keys.length) throw Error('Bảng không có khóa chính để xác định bản ghi.');
      $('#save').disabled = true;
      await api(`/api/table/${name(state.table)}`, {
        method: state.edit ? 'PATCH' : 'POST',
        body: JSON.stringify({ values, key }),
      });
      $('#editor').close();
      toast(state.edit ? 'Đã lưu thay đổi' : 'Đã thêm bản ghi');
      await refreshAfterWrite();
    } catch (err) {
      $('#formError').textContent = err.message;
    } finally {
      $('#save').disabled = false;
    }
  };
  $('#delete').onclick = () => {
    if (state.edit) void deleteRecords([state.edit]);
  };
  $('#add').onclick = () => openEditor(null);
  $('#closeEditor').onclick = $('#cancel').onclick = () => $('#editor').close();
  $('#refresh').onclick = () => load();
  $('#prev').onclick = () => {
    state.page--;
    persistView();
    void load({ silent: true });
  };
  $('#next').onclick = () => {
    state.page++;
    persistView();
    void load({ silent: true });
  };
  $('#search').oninput = () => {
    state.page = 0;
    persistView();
    clearTimeout(timer);
    timer = setTimeout(() => load({ silent: true }), 350);
  };
}

async function pasteFromCell(rowValue, columnName, text) {
  const values = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map(line => line.split('\t'));
  const visible = [...document.querySelectorAll('#grid td[data-bulk-column]')].filter(
      cell => cell.dataset.bulkColumn === columnName,
    ),
    from = visible.findIndex(cell => cell.dataset.bulkRow === rowValue),
    rowIndexes = visible.slice(from, from + values.length).map(cell => Number(cell.dataset.bulkRow)),
    column = displayedColumns().findIndex(spec => spec.column?.name === columnName);
  if (from < 0 || rowIndexes.length !== values.length) {
    toast('Vùng dán vượt quá các bản ghi đang hiển thị.');
    return;
  }
  bulkBusy = true;
  try {
    await pasteCells(column, Number(rowValue), values, rowIndexes);
    clearBulk();
  } catch (error) {
    clearBulk();
    $('#bulkError').textContent = error.message;
    $('#bulkBar').hidden = false;
    $('#bulkApply').disabled = true;
  } finally {
    bulkBusy = false;
  }
}
// Runs fn over items with at most `limit` calls in flight.
async function runLimited(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
async function pasteCells(startColumn, startRow, values, rowIndexes, { clear = false } = {}) {
  const table = state.table,
    columns = displayedColumns(),
    rows = state.rows.slice();
  if (!table?.primary_keys?.length) throw Error('Bảng không có khóa chính chỉ được xem.');
  if (!Array.isArray(values) || !values.length || values.length > 50) throw Error('Vùng dán không hợp lệ.');
  const changes = [];
  for (let y = 0; y < values.length; y++) {
    const rowIndex = rowIndexes?.[y] ?? startRow + y,
      row = rows[rowIndex];
    if (!row) throw Error('Vùng dán vượt quá các bản ghi trên trang.');
    if (pendingRows.has(row)) throw Error(`Dòng ${rowIndex + 1} đang được lưu.`);
    const data = {},
      expected = {};
    for (let x = 0; x < values[y].length; x++) {
      const index = startColumn + x,
        spec = columns[index],
        col = spec?.column,
        raw = values[y][x];
      if (clear ? !col || !writable(col) || table.primary_keys.includes(col.name) : !batchWritable(col, table))
        throw Error(`Cột ${col?.name || index + 1} không thể sửa hàng loạt.`);
      let value;
      if (clear) value = null;
      else if (col.data_type === 'boolean') {
        const text = String(raw).trim().toLowerCase();
        if (text === '' && col.options.includes('nullable')) value = null;
        else if (['true', '1', 'đúng'].includes(text)) value = true;
        else if (['false', '0', 'sai'].includes(text)) value = false;
        else throw Error(`Cột ${col.name} cần giá trị true hoặc false.`);
      } else if (/^(numeric|decimal)$/.test(col.data_type)) {
        const text = String(raw).trim().replace(/,/g, '');
        if (!text) value = null;
        else if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw Error(`Cột ${col.name} cần một số hợp lệ.`);
        else value = text;
      } else value = valueFor(col, String(raw));
      if (value === null && !col.options.includes('nullable')) throw Error(`Cột ${col.name} không được để trống.`);
      if (value !== null && col.enum_values?.length && !col.enum_values.includes(value))
        throw Error(`Giá trị của cột ${col.name} không hợp lệ.`);
      if (/^(integer|smallint)$/.test(col.data_type) && value !== null && !Number.isInteger(value))
        throw Error(`Cột ${col.name} cần số nguyên.`);
      if (!(value === null ? row[col.name] == null : String(value) === String(row[col.name] ?? ''))) {
        data[col.name] = value;
        expected[col.name] = row[col.name] ?? null;
      }
    }
    if (Object.keys(data).length)
      changes.push({
        row: rowIndex + 1,
        record: row,
        key: Object.fromEntries(table.primary_keys.map(k => [k, row[k]])),
        values: data,
        expected,
      });
  }
  let saved = 0;
  const failed = [];
  for (const change of changes) {
    pendingRows.add(change.record);
    Object.assign(change.record, change.values);
  }
  if (changes.length && state.table === table && !state.cellEdit) render();
  const errors = new Array(changes.length);
  await runLimited(changes, 5, async (change, index) => {
    try {
      const result = await api(`/api/table/${name(table)}`, {
        method: 'PATCH',
        body: JSON.stringify({ key: change.key, values: change.values, expected: change.expected }),
      });
      if (!result.rows?.length) throw Error('Không tìm thấy bản ghi.');
      Object.assign(change.record, result.rows[0]);
      saved++;
    } catch (error) {
      Object.assign(change.record, change.expected);
      errors[index] = `Dòng ${change.row}: ${error.message}`;
    } finally {
      pendingRows.delete(change.record);
      if (state.table === table && !state.cellEdit) render();
    }
  });
  failed.push(...errors.filter(Boolean));
  if (saved) {
    const history = historyFor(table);
    history.undo = [];
    history.redo = [];
    updateHistoryButtons();
  }
  if (state.table === table) await load({ silent: true });
  if (failed.length) throw Error(`Đã lưu ${saved}/${changes.length} dòng. ${failed.join('; ')}`);
  toast(changes.length ? `Đã lưu ${saved} dòng` : 'Không có thay đổi');
}
export function typeIcon(c) {
  if (c.data_type === 'boolean') return 'B';
  if (/int|numeric|decimal|real|double/.test(c.data_type)) return '#';
  if (/date|time/.test(c.data_type)) return '◷';
  if (c.data_type === 'jsonb' || c.data_type === 'json') return '{}';
  return 'T';
}
function recordFieldHint(column) {
  if (!state.configReady) return 'Đang tải cấu hình cột.';
  const details = (column.description || column.comment || '').trim();
  if (details) return details;
  if (state.table.primary_keys?.includes(column.name) && column.default_value)
    return 'Khóa định danh của bản ghi; để trống để dùng giá trị mặc định.';
  if (!writable(column)) return 'Giá trị do Supabase tự tạo hoặc tính toán.';
  const name = column.name.toLowerCase();
  const hints = {
    name: state.table.name.includes('room_types') ? 'Tên loại phòng.' : 'Tên hiển thị.',
    name_en: 'Tên hiển thị bằng tiếng Anh.',
    description: 'Nội dung mô tả.',
    description_en: 'Nội dung mô tả bằng tiếng Anh.',
    branchid: 'Mã chi nhánh mà bản ghi này thuộc về.',
    tag: 'Nhãn dùng để phân loại.',
    address: 'Địa chỉ chi nhánh.',
    address_en: 'Địa chỉ bằng tiếng Anh.',
    amenities: 'Danh sách tiện nghi, ngăn cách bằng dấu phẩy.',
    amenities_en: 'Danh sách tiện nghi bằng tiếng Anh.',
    excluded_amenities: 'Danh sách tiện nghi không bao gồm, ngăn cách bằng dấu phẩy.',
    excluded_amenities_en: 'Danh sách tiện nghi không bao gồm bằng tiếng Anh.',
    weekdayprice: 'Giá vào ngày thường (VND).',
    weekendprice: 'Giá vào cuối tuần (VND).',
    monthly_under_3: 'Giá thuê theo tháng dưới 3 tháng (VND).',
    monthly_over_3: 'Giá thuê theo tháng từ 3 tháng trở lên (VND).',
    sqm: 'Diện tích phòng tính bằng mét vuông.',
    is_hidden: 'Bật true để ẩn mục khỏi giao diện.',
    fees: 'Các khoản phí và cách tính.',
    policies: 'Chính sách dạng JSON.',
    excluded_amenities_en: 'Danh sách tiện nghi không bao gồm bằng tiếng Anh.',
    amount: 'Số tiền điều chỉnh.',
    note: 'Ghi chú bổ sung.',
    date: 'Ngày áp dụng.',
  };
  if (hints[name]) return hints[name];
  if (column.enum_values?.length) return 'Chọn một giá trị trong danh sách.';
  if (column.data_type === 'boolean') return 'Chọn true hoặc false.';
  if (column.data_type === 'date') return 'Chọn ngày áp dụng.';
  if (/json/.test(column.data_type) || column.data_type.startsWith('_')) return 'Nhập dữ liệu JSON hợp lệ.';
  if (/^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(column.data_type))
    return 'Nhập giá trị số; có thể dùng dấu phẩy ngăn cách hàng nghìn.';
  const foreignKey = state.table.foreign_key_constraints?.find(item => item.source_columns?.includes(column.name));
  if (foreignKey) return `Mã bản ghi liên kết đến ${foreignKey.target_table.replace(/^public\./, '')}.`;
  return 'Nhập nội dung cho trường này.';
}
export function openEditor(row) {
  state.edit = row;
  $('#dialogTitle').textContent = row ? 'Chỉnh sửa bản ghi' : 'Thêm bản ghi';
  $('#dialogEyebrow').textContent = name(state.table);
  $('#save').textContent = row ? 'Lưu thay đổi' : 'Thêm bản ghi';
  $('#delete').hidden = !row;
  $('#delete').disabled = deletionBusy || !state.configReady || !state.table.primary_keys?.length;
  $('#save').disabled = deletionBusy || !state.configReady;
  $('#formError').textContent = '';
  const fields = $('#formFields');
  fields.replaceChildren();
  for (const c of state.table.columns) {
    const box = el('div', 'field' + (/json|text/.test(c.data_type) ? ' wide' : ''));
    const label = el('label', '', c.name);
    const optional = c.options.includes('nullable') || !!c.default_value || c.options.includes('identity');
    if (row && state.table.primary_keys?.includes(c.name)) label.append(el('small', '', 'Khóa chính · chỉ đọc'));
    else if (!writable(c) || !optional) label.append(el('small', '', !writable(c) ? 'Tự sinh' : 'Bắt buộc'));
    let input;
    const v = row?.[c.name];
    const disabled =
      !writable(c) || !state.table.primary_keys?.length || !!(row && state.table.primary_keys.includes(c.name));
    if (c.enum_values?.length) {
      const initial = v == null ? '' : String(v);
      const opts = [];
      if (optional) opts.push({ value: '', label: 'Trống (null)', pill: '—', pillType: 't' });
      for (const option of c.enum_values) opts.push({ value: option, label: option });
      input = el('input');
      input.type = 'hidden';
      input.id = 'field-' + c.name;
      input.dataset.column = c.name;
      input.dataset.original = initial;
      input.value = initial;
      input.disabled = disabled;
      const custom = createCustomSelect({
        options: opts,
        value: initial,
        ariaLabel: c.name,
        className: 'form-field-select',
        onChange(newVal) {
          input.value = newVal;
        },
      });
      if (disabled) custom.btn.disabled = true;
      input._syncSelect = newVal => custom.setValue(newVal);
      label.onclick = () => custom.btn.focus();
      box.append(label, custom, input);
    } else if (c.data_type === 'boolean') {
      const initial = v === true ? 'true' : v === false ? 'false' : optional ? '' : 'false';
      const opts = [];
      if (optional) opts.push({ value: '', label: 'Trống (null)', pill: '—', pillType: 't' });
      opts.push(
        { value: 'true', label: 'true', pill: 'T', pillType: 'bool' },
        { value: 'false', label: 'false', pill: 'F', pillType: 'num' },
      );
      input = el('input');
      input.type = 'hidden';
      input.id = 'field-' + c.name;
      input.dataset.column = c.name;
      input.dataset.original = initial;
      input.value = initial;
      input.disabled = disabled;
      const custom = createCustomSelect({
        options: opts,
        value: initial,
        ariaLabel: c.name,
        className: 'form-field-select',
        onChange(newVal) {
          input.value = newVal;
        },
      });
      if (disabled) custom.btn.disabled = true;
      input._syncSelect = newVal => custom.setValue(newVal);
      label.onclick = () => custom.btn.focus();
      box.append(label, custom, input);
    } else if (/json/.test(c.data_type) || c.data_type.startsWith('_') || c.data_type === 'text') {
      input = el('textarea');
      input.value = v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      input.id = 'field-' + c.name;
      input.dataset.column = c.name;
      input.dataset.original = input.value;
      input.disabled = disabled;
      if (!row && !optional && writable(c)) input.required = true;
      label.htmlFor = input.id;
      box.append(label, input);
    } else {
      input = el('input');
      const numeric = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type);
      input.type = c.data_type === 'date' ? 'date' : 'text';
      if (numeric) {
        input.inputMode = 'decimal';
        input.value = v == null ? '' : formatNumber(v);
        input.oninput = () => formatNumberInput(input);
      } else input.value = v == null ? '' : String(v);
      input.id = 'field-' + c.name;
      input.dataset.column = c.name;
      input.dataset.original = input.value;
      input.disabled = disabled;
      if (!row && !optional && writable(c)) input.required = true;
      label.htmlFor = input.id;
      box.append(label, input);
    }
    box.append(el('div', 'field-hint', recordFieldHint(c)));
    const info = writable(c) && c.default_value ? 'Để trống để dùng giá trị mặc định' : '';
    if (info) box.append(el('div', 'detail', info));
    fields.append(box);
  }
  $('#editor').showModal();
}
export function valueFor(c, raw) {
  if (raw === '') return null;
  if (c.data_type === 'boolean') return raw === 'true';
  if (/json/.test(c.data_type) || c.data_type.startsWith('_')) {
    try {
      return JSON.parse(raw);
    } catch {
      throw Error(`Cột ${c.name} cần JSON hợp lệ.`);
    }
  }
  if (/^(bigint|numeric|decimal)$/.test(c.data_type)) {
    const value = String(raw).trim().replace(/,/g, ''),
      pattern = c.data_type === 'bigint' ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
    if (!pattern.test(value))
      throw Error(`Cột ${c.name} cần ${c.data_type === 'bigint' ? 'số nguyên' : 'một số hợp lệ'}.`);
    return value;
  }
  if (/^(integer|smallint|real|double precision)$/.test(c.data_type)) {
    const value = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(value) || (/^(integer|smallint)$/.test(c.data_type) && !Number.isInteger(value)))
      throw Error(`Cột ${c.name} cần một số hợp lệ.`);
    return value;
  }
  return raw;
}
let timer;
export function syncEditorReadiness() {
  if (!$('#editor').open || !state.table) return;
  const hasKey = !!state.table.primary_keys?.length;
  for (const input of $('#formFields').querySelectorAll('[data-column]')) {
    const c = state.table.columns.find(x => x.name === input.dataset.column);
    if (!c) continue;
    const disabled =
      !state.configReady || !hasKey || !writable(c) || !!(state.edit && state.table.primary_keys.includes(c.name));
    input.disabled = disabled;
    const button = input.closest('.field')?.querySelector('.custom-select-btn');
    if (button) button.disabled = disabled;
    const hint = input.closest('.field')?.querySelector('.field-hint');
    if (hint) hint.textContent = recordFieldHint(c);
  }
  $('#save').disabled = deletionBusy || !state.configReady || !hasKey;
  $('#delete').disabled = deletionBusy || !state.configReady || !hasKey;
}
function showConfigStatus(text, retry = false) {
  const box = $('#configStatus');
  box.hidden = !text;
  $('#configStatusText').textContent = text;
  $('#retryConfig').hidden = !retry;
}
function scheduleLookupCleanup() {
  if (!state.initialRowsReady || !state.cleanupPending) return;
  state.cleanupPending = false;
  setTimeout(async () => {
    try {
      await api('/api/lookup-config/cleanup-disabled', { method: 'POST', body: '{}' });
      state.lookups = state.lookups.filter(x => !(x.columnBound === true && x.sync?.enabled === false));
    } catch (error) {
      toast('Không thể xóa lookup đã tắt: ' + error.message);
    }
  }, 0);
}
async function loadConfigs(request) {
  const attempt = ++state.configAttempt;
  state.configReady = false;
  showConfigStatus('Đang tải cấu hình cột…');
  $('#add').disabled = true;
  updateHistoryButtons();
  try {
    const [formula, cloud] = await (request || Promise.all([api('/api/formula-config'), api('/api/lookup-config')]));
    if (attempt !== state.configAttempt) return;
    if (
      !Array.isArray(formula.items) ||
      typeof cloud.available !== 'boolean' ||
      (cloud.available && !Array.isArray(cloud.items))
    )
      throw Error('Cấu hình nhận được không hợp lệ.');
    state.formulas = formula.items;
    setLookupCloudAvailable(cloud.available);
    if (cloud.available) state.lookups = cloud.items;
    state.cleanupPending = state.lookups.some(x => x.columnBound === true && x.sync?.enabled === false);
    state.configReady = true;
    showConfigStatus('');
    syncEditorReadiness();
    if (state.table) {
      $('#add').disabled = !state.table.primary_keys?.length;
      updateHistoryButtons();
      render();
      loadLookups();
      loadNativeDisplays();
    }
    scheduleLookupCleanup();
  } catch {
    if (attempt !== state.configAttempt) return;
    state.configReady = false;
    syncEditorReadiness();
    showConfigStatus('Không thể tải cấu hình cột. Bảng đang ở chế độ chỉ đọc.', true);
    if (state.table) {
      $('#add').disabled = true;
      updateHistoryButtons();
      render();
    }
  }
}
export async function initMain2() {
  $('#retryConfig').onclick = () => {
    void loadConfigs();
  };
  await initialize();
}

async function initialize() {
  const request = Promise.all([api('/api/formula-config'), api('/api/lookup-config')]);
  request.catch(() => {});
  try {
    const data = await api('/api/meta');
    state.tables = data.tables;
    state.adminAvailable = !!data.adminAvailable;
    state.adminError = data.adminError || '';
    state.enumTypes = Array.isArray(data.enumTypes) ? data.enumTypes : [];
    restoreSidebar();
    restoreLookups();
    restoreViews();
    state.token = data.token;
    nav();
    let current;
    try {
      current = localStorage.getItem('siris-current-table');
    } catch {}
    if (state.tables.length) choose(state.tables.find(t => name(t) === current) || state.tables[0]);
    else message('Không có bảng nào để hiển thị.');
    await loadConfigs(request);
  } catch (e) {
    $('#tables').textContent = 'Không thể tải danh sách bảng';
    message(e.message, true);
  }
}
