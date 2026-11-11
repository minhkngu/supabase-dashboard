import { fieldHints } from '../table-config.mjs';
import { api, toast } from './api.js';
import { createCustomSelect } from './custom-select.js';
import { deleteRecords, refreshAfterWrite } from './deletion.js';
import { formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { load } from './grid/render.js';
import { $, $$, PAGE_SIZES, deletionBusy, el, name, pageSize, state, writable } from './state.js';
import { persistView } from './view-menus.js';

export function typeIcon(c) {
  if (c.data_type === 'boolean') return 'B';
  if (/int|numeric|decimal|real|double/.test(c.data_type)) return '#';
  if (/date|time/.test(c.data_type)) return '◷';
  if (c.data_type === 'jsonb' || c.data_type === 'json') return '{}';
  return 'T';
}
export function recordFieldHint(column) {
  if (!state.configReady) return 'Đang tải cấu hình cột.';
  const details = (column.description || column.comment || '').trim();
  if (details) return details;
  if (state.table.primary_keys?.includes(column.name) && column.default_value)
    return 'Khóa định danh của bản ghi; để trống để dùng giá trị mặc định.';
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
  $('#pageSize').onchange = () => {
    const size = Number($('#pageSize').value);
    if (!state.view || !PAGE_SIZES.includes(size) || size === pageSize()) return;
    // Keep the first visible row on screen when the page size changes.
    const firstRow = state.page * pageSize();
    state.view.pageSize = size;
    state.page = Math.floor(firstRow / size);
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

let timer;
