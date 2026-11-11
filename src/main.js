import { api, message, toast } from './api.js';
import { createCustomSelect } from './custom-select.js';
import { deleteRecords, refreshAfterWrite } from './deletion.js';
import { formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { choose, load, render } from './grid/render.js';
import { updateHistoryButtons } from './history.js';
import { loadLookups, restoreLookups, setLookupCloudAvailable } from './lookup.js';
import { loadNativeDisplays } from './relation-display.js';
import { nav, restoreSidebar } from './sidebar.js';
import { $, deletionBusy, el, name, state, writable } from './state.js';
import { persistView, restoreViews } from './view-menus.js';

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
export function initMain() {
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
