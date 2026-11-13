import { setPage } from './grid/grid-state.js';
import { writeApi } from './write-api.js';
import { isPromotionsOverview } from './overview/mode.js';
import { lookupTable } from './lookup.js';
import { nativeRelations, relationDisplayField } from './relation-display.js';
import { fieldHints } from '../table-config.mjs';
import { api, message, toast } from './api.js';
import { createCustomSelect } from './custom-select.js';
import { deleteRecords, refreshAfterWrite } from './deletion.js';
import { formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { gridAction } from './events.js';
import { $, $$, PAGE_SIZES, deletionBusy, el, loadController, name, pageSize, state, writable } from './state.js';
import { persistView } from './view-menus.js';

export function recordFieldHint(column, row = null) {
  if (!state.configReady) return 'Đang tải cấu hình cột.';
  const details = (column.description || column.comment || '').trim();
  if (details) return details;
  if (state.table.primary_keys?.includes(column.name) && column.default_value)
    return row ? 'Khóa định danh của bản ghi.' : 'Khóa định danh của bản ghi; để trống để dùng giá trị mặc định.';
  if (!writable(column)) return 'Giá trị do Supabase tự tạo hoặc tính toán.';
  const name = column.name.toLowerCase();
  const hints = fieldHints(state.table.name);

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
  // Deleting stays in the grid, where rows are selected deliberately.
  $('#delete').hidden = !row || isPromotionsOverview();
  $('#delete').disabled = deletionBusy || !state.configReady || !state.table.primary_keys?.length;
  $('#save').disabled = deletionBusy || !state.configReady;
  $('#formError').textContent = '';
  const fields = $('#formFields');
  fields.replaceChildren();
  const readonly = c =>
    !writable(c) || !state.table.primary_keys?.length || !!(row && state.table.primary_keys.includes(c.name));
  // Editable fields first; read-only ones are grouped at the end.
  const columns = [...state.table.columns.filter(c => !readonly(c)), ...state.table.columns.filter(readonly)];
  for (const c of columns) {
    const v = row?.[c.name],
      disabled = readonly(c),
      optional = c.options.includes('nullable') || !!c.default_value || c.options.includes('identity'),
      structured = /json/.test(c.data_type) || c.data_type.startsWith('_'),
      longText = typeof v === 'string' && (v.length > 80 || v.includes('\n')),
      box = el('div', 'field' + (structured || longText ? ' wide' : '') + (disabled ? ' field-readonly' : '')),
      label = el('label', '', c.name);
    if (row && state.table.primary_keys?.includes(c.name)) label.append(el('small', '', 'Khóa chính · chỉ đọc'));
    else if (disabled || !optional) label.append(el('small', '', disabled ? 'Tự sinh' : 'Bắt buộc'));
    const relation = nativeRelations().find(r => r.config.sourceColumn === c.name);
    let input;
    if (c.enum_values?.length) {
      const opts = [];
      if (optional) opts.push({ value: '', label: 'Trống (null)', pill: '—', pillType: 't' });
      for (const option of c.enum_values) opts.push({ value: option, label: option });
      input = selectField(box, label, c, v == null ? '' : String(v), opts, disabled);
    } else if (c.data_type === 'boolean') {
      input = switchField(box, label, c, v === true ? 'true' : v === false ? 'false' : optional ? '' : 'false', {
        disabled,
        nullable: c.options.includes('nullable'),
      });
    } else if (relation && !disabled) {
      input = recordPickerField(box, label, c, relation, v, optional);
    } else if (structured || longText) {
      input = el('textarea');
      input.value = v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
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
      box.append(label, input);
    }
    if (input.tagName !== 'INPUT' || input.type !== 'hidden') {
      input.id = 'field-' + c.name;
      input.dataset.column = c.name;
      input.dataset.original = input.value;
      input.disabled = disabled;
      if (!row && !optional && !disabled) input.required = true;
      label.htmlFor = input.id;
    }
    box.append(el('div', 'field-hint', recordFieldHint(c, row)));
    if (!row && !disabled && c.default_value) box.append(el('div', 'detail', 'Để trống để dùng giá trị mặc định'));
    fields.append(box);
  }
  $('#editor').showModal();
}
function hiddenValue(c, initial, disabled) {
  const input = el('input');
  input.type = 'hidden';
  input.id = 'field-' + c.name;
  input.dataset.column = c.name;
  input.dataset.original = initial;
  input.value = initial;
  input.disabled = disabled;
  return input;
}
function selectField(box, label, c, initial, options, disabled, extra = {}) {
  const input = hiddenValue(c, initial, disabled);
  const custom = createCustomSelect({
    options,
    value: initial,
    ariaLabel: c.name,
    className: 'form-field-select',
    onChange(newVal) {
      input.value = newVal;
    },
    ...extra,
  });
  if (disabled) custom.btn.disabled = true;
  input._syncSelect = newVal => custom.setValue(newVal);
  label.onclick = () => custom.btn.focus();
  box.append(label, custom, input);
  return input;
}
// Booleans use a switch; a nullable boolean can also be cleared to null.
function switchField(box, label, c, initial, { disabled, nullable }) {
  const input = hiddenValue(c, initial, disabled),
    row = el('div', 'field-switch'),
    wrap = el('span', 'column-switch-wrap'),
    toggle = el('input', 'column-switch-input'),
    stateText = el('span', 'field-switch-state');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  toggle.id = 'switch-' + c.name;
  toggle.disabled = disabled;
  label.htmlFor = toggle.id;
  wrap.append(toggle, el('span', 'column-switch-slider'));
  const draw = () => {
    toggle.checked = input.value === 'true';
    toggle.indeterminate = input.value === '';
    toggle.setAttribute('aria-checked', input.value === '' ? 'mixed' : String(toggle.checked));
    stateText.textContent =
      input.value === '' ? 'Trống (null)' : input.value === 'true' ? 'Có (true)' : 'Không (false)';
    clear.hidden = !nullable || disabled || input.value === '';
  };
  toggle.onchange = () => {
    input.value = toggle.checked ? 'true' : 'false';
    draw();
  };
  // Clicking the visual slider must toggle the hidden checkbox.
  wrap.onclick = event => {
    if (event.target !== toggle && !toggle.disabled) toggle.click();
  };
  const clear = el('button', 'field-switch-clear', 'Để trống');
  clear.type = 'button';
  clear.onclick = () => {
    input.value = '';
    draw();
  };
  input._syncSelect = draw;
  row.append(wrap, stateText, clear);
  box.append(label, row, input);
  draw();
  return input;
}
// Foreign keys pick a linked record by its display field instead of typing a key.
function recordPickerField(box, label, c, relation, value, optional) {
  const initial = value == null ? '' : String(value),
    blank = optional ? [{ value: '', label: 'Trống (null)', pill: '—', pillType: 't' }] : [],
    current = initial ? [{ value: initial, label: initial }] : [];
  const input = selectField(box, label, c, initial, [...blank, ...current], false);
  const target = lookupTable(relation.config.targetTable),
    field = relationDisplayField(relation),
    key = relation.config.targetKey;
  if (!target) return input;
  const query = new URLSearchParams({
    page: '0',
    limit: '1000',
    search: '',
    filters: '[]',
    orders: JSON.stringify([{ column: field, direction: 'asc' }]),
  });
  api(`/api/table/${name(target)}?${query}`)
    .then(result => {
      if (!box.isConnected) return;
      const options = result.rows
        .filter(row => row[key] != null)
        .map(row => ({
          value: String(row[key]),
          label: row[field] == null || field === key ? String(row[key]) : `${row[field]}`,
        }));
      if (initial && !options.some(option => option.value === initial)) options.unshift(current[0]);
      const old = box.querySelector('.custom-select-wrap'),
        replacement = createCustomSelect({
          options: [...blank, ...options],
          value: input.value,
          ariaLabel: c.name,
          className: 'form-field-select',
          searchPlaceholder: `Tìm trong ${name(target)}`,
          onChange(newVal) {
            input.value = newVal;
          },
        });
      input._syncSelect = newVal => replacement.setValue(newVal);
      label.onclick = () => replacement.btn.focus();
      old.replaceWith(replacement);
    })
    .catch(() => {
      if (box.isConnected) box.querySelector('.field-hint')?.append(' Không tải được danh sách bản ghi liên kết.');
    });
  return input;
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
export function initRecordEditor() {
  $('#form').onsubmit = async e => {
    e.preventDefault();
    if (deletionBusy || !state.configReady) return;
    $('#formError').textContent = '';
    try {
      const values = {};
      for (const input of $$('#formFields [data-column]')) {
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
      await writeApi(`/api/table/${name(state.table)}`, {
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
  // Keep the current grid usable while refreshing; silent loads also avoid
  // replacing an active editor or a row whose changes are still saving.
  $('#refresh').onclick = () => gridAction('load', { silent: true });
  $('#prev').onclick = () => {
    setPage(state.page - 1);
    persistView();
    void gridAction('load', { silent: true });
  };
  $('#pageSize').onchange = () => {
    const size = Number($('#pageSize').value);
    if (!state.view || !PAGE_SIZES.includes(size) || size === pageSize()) return;
    // Keep the first visible row on screen when the page size changes.
    const firstRow = state.page * pageSize();
    state.view.pageSize = size;
    setPage(Math.floor(firstRow / size));
    persistView();
    void gridAction('load', { silent: true });
  };
  $('#next').onclick = () => {
    setPage(state.page + 1);
    persistView();
    void gridAction('load', { silent: true });
  };
  let previewTimer;
  $('#search').oninput = () => {
    setPage(0);
    persistView();
    clearTimeout(timer);
    clearTimeout(previewTimer);
    const value = $('#search').value.trim();
    if (value && value.length < 2) {
      loadController?.abort();
      state.loadVersion++;
      message('Nhập ít nhất 2 ký tự để tìm kiếm.');
      return;
    }
    message('');
    if (value) {
      previewTimer = setTimeout(() => gridAction('load', { silent: true, skipCount: true }), 0);
      timer = setTimeout(() => gridAction('load', { silent: true, forceCount: true }), 350);
    } else void gridAction('load', { silent: true });
  };
  $('#searchColumn').onchange = () => {
    setPage(0);
    persistView();
    const value = $('#search').value.trim();
    if (!value || value.length >= 2) void gridAction('load', { silent: true });
  };
}

let timer;
