import { api, message, toast } from './api.js';
import { createCustomSelect } from './custom-select.js';
import { deleteRecords, refreshAfterWrite } from './deletion.js';
import { formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { choose, load, render } from './grid/render.js';
import { historyFor, updateHistoryButtons } from './history.js';
import { loadLookups, restoreLookups, setLookupCloudAvailable } from './lookup.js';
import { loadNativeDisplays, nativeRelations } from './relation-display.js';
import { nav, restoreSidebar } from './sidebar.js';
import { $, deletionBusy, el, name, pendingRows, state, writable } from './state.js';
import { displayedColumns, persistView, restoreViews } from './view-menus.js';

export let selectionAnchor = null,
  selectedCells = [],
  bulkBusy = false,
  dragSelection = null,
  copySelection = [],
  virtualAnchor = null;
export function syncGrid(live, next) {
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
export function selectBulk(td, row, c, deferEditor = false) {
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

export async function pasteFromCell(rowValue, columnName, text) {
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
export function scheduleLookupCleanup() {
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
export function setDragSelection(value) {
  return (dragSelection = value);
}

export function setCopySelection(value) {
  return (copySelection = value);
}
