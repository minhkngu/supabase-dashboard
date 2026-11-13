import { toast } from './api.js';
import {
  activeLookups,
  checkLookupSync,
  configValid,
  fillOptions,
  fillTableOptions,
  lookupCloudAvailable,
  lookupConditions,
  lookupTable,
  lookupType,
} from './lookup.js';
import { $, el, name, state } from './state.js';

export function initColumnSync() {
  $('#columnSyncEnabled').onchange = () => {
    if ($('#columnSyncEnabled').checked && $('#columnFormulaEnabled').checked) {
      $('#columnSyncEnabled').checked = false;
      toast('Hãy tắt formula trước khi bật lookup.');
    }
    updateColumnSync();
  };
  $('#columnSyncTable').onchange = () => {
    columnSyncDraft = columnSyncDraft.map(r => ({ ...r, targetKey: '' }));
    $('#columnSyncField').value = '';
    refreshColumnSyncFields();
  };
  $('#columnSyncField').onchange =
    $('#columnSyncDisplay').onchange =
    $('#columnSyncMode').onchange =
      validateColumnSyncDraft;
  $('#columnSyncAddCondition').onclick = () => {
    if (columnSyncDraft.length >= 10) return;
    columnSyncDraft.push({ sourceColumn: '', targetKey: '' });
    drawColumnSyncConditions();
  };
}

let columnSyncDraft = [];
function drawColumnSyncConditions() {
  const host = $('#columnSyncConditions'),
    target = lookupTable($('#columnSyncTable').value),
    column = state.columnEdit?.column;
  host.replaceChildren();
  columnSyncDraft.forEach((rule, index) => {
    const row = el('div', 'lookup-condition'),
      source = el('select'),
      operator = el('span', 'column-sync-equals', 'bằng'),
      dest = el('select'),
      remove = el('button', 'quiet', '×');
    source.setAttribute('aria-label', `Cột hiện tại lookup ${index + 1}`);
    dest.setAttribute('aria-label', `Cột nguồn lookup ${index + 1}`);
    fillOptions(
      source,
      state.table.columns.filter(c => c.name !== column?.name && lookupType(c)).map(c => c.name),
      'Cột hiện tại',
    );
    source.value = rule.sourceColumn;
    const sourceColumn = state.table.columns.find(c => c.name === rule.sourceColumn);
    fillOptions(
      dest,
      (target?.columns || [])
        .filter(c => lookupType(c) && (!sourceColumn || lookupType(c) === lookupType(sourceColumn)))
        .map(c => c.name),
      'Cột nguồn',
    );
    dest.value = rule.targetKey;
    source.onchange = () => {
      rule.sourceColumn = source.value;
      rule.targetKey = '';
      drawColumnSyncConditions();
      validateColumnSyncDraft();
    };
    dest.onchange = () => {
      rule.targetKey = dest.value;
      validateColumnSyncDraft();
    };
    remove.type = 'button';
    remove.setAttribute('aria-label', `Xóa điều kiện lookup ${index + 1}`);
    remove.disabled = columnSyncDraft.length === 1;
    remove.onclick = () => {
      columnSyncDraft.splice(index, 1);
      drawColumnSyncConditions();
      validateColumnSyncDraft();
    };
    row.append(source, operator, dest, remove);
    host.append(row);
  });
  $('#columnSyncAddCondition').disabled = columnSyncDraft.length >= 10;
}
function refreshColumnSyncFields() {
  const field = $('#columnSyncField').value,
    target = lookupTable($('#columnSyncTable').value);
  fillOptions($('#columnSyncField'), target?.columns.map(c => c.name) || [], 'Chọn trường cần lấy');
  $('#columnSyncField').value = field;
  drawColumnSyncConditions();
  validateColumnSyncDraft();
}
export function columnSyncSettingsSnapshot() {
  return JSON.stringify({
    table: $('#columnSyncTable').value,
    field: $('#columnSyncField').value,
    mode: $('#columnSyncMode').value,
    display: $('#columnSyncDisplay').value,
    conditions: columnSyncDraft,
  });
}
export function setupColumnSync(spec) {
  const column = spec?.column;
  $('#columnSyncSection').hidden = !column;
  if (!column) {
    state.columnSyncInitial = null;
    $('#columnSyncConfig')
      .querySelectorAll('select')
      .forEach(input => {
        input.disabled = true;
        input.required = false;
      });
    return;
  }
  const active = activeLookups().find(x => x.sync?.enabled && x.sync.columnName === column.name),
    previous = active || activeLookups().find(x => x.sync?.columnName === column.name);
  $('#columnSyncEnabled').checked = !!active;
  fillTableOptions($('#columnSyncTable'), 'Chọn bảng nguồn', t => name(t) !== name(state.table));
  $('#columnSyncTable').value = previous?.targetTable || '';
  columnSyncDraft = previous ? lookupConditions(previous).map(r => ({ ...r })) : [{ sourceColumn: '', targetKey: '' }];
  refreshColumnSyncFields();
  $('#columnSyncField').value = previous?.targetField || '';
  $('#columnSyncMode').value = previous?.mode || 'all';
  $('#columnSyncDisplay').value = previous?.display || 'value';
  const blocked =
    !lookupCloudAvailable ||
    column.protected ||
    state.table.primary_keys.includes(column.name) ||
    column.options.some(x => ['generated', 'identity'].includes(x));
  $('#columnSyncEnabled').disabled = !!blocked;
  state.columnSyncInitial = {
    enabled: !!active,
    id: previous?.id || `column-lookup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    previous,
    draft: columnSyncSettingsSnapshot(),
  };
  updateColumnSync();
}
export function columnSyncConfig(columnName) {
  const column = state.columnEdit?.column,
    initial = state.columnSyncInitial,
    enabled = $('#columnSyncEnabled').checked;
  if (!column || !initial) throw Error('Không tìm thấy cột nhận lookup.');
  const target = columnName || column.name;
  if (!enabled) return { ...initial.previous, sync: { enabled: false, columnName: target }, columnBound: true };
  const conditions = columnSyncDraft.map(r => ({ ...r }));
  const config = {
    id: initial.id,
    label: target,
    sourceTable: name(state.table),
    targetTable: $('#columnSyncTable').value,
    targetField: $('#columnSyncField').value,
    sourceColumn: conditions[0]?.sourceColumn,
    targetKey: conditions[0]?.targetKey,
    conditions,
    mode: $('#columnSyncMode').value,
    display: $('#columnSyncDisplay').value,
    format: initial.previous?.format || 'default',
    columnBound: true,
    sync: { enabled: true, columnName: target },
  };
  if (!configValid(config)) throw Error('Chọn bảng nguồn, trường cần lấy và các cột đối chiếu phù hợp.');
  checkLookupSync(config);
  return config;
}
function validateColumnSyncDraft() {
  $('#columnError').textContent = '';
  if ($('#columnSyncEnabled').checked && $('#columnSyncField').value) {
    try {
      const column = state.columnEdit?.column,
        field = lookupTable($('#columnSyncTable').value)?.columns.find(c => c.name === $('#columnSyncField').value);
      if (column && field)
        checkLookupSync({
          targetTable: $('#columnSyncTable').value,
          targetField: field.name,
          display: $('#columnSyncDisplay').value,
          sync: { enabled: true, columnName: column.name },
        });
    } catch (error) {
      $('#columnError').textContent = error.message;
    }
  }
}
function updateColumnSync() {
  const column = state.columnEdit?.column;
  if (!column) return;
  const enabled = $('#columnSyncEnabled').checked;
  $('#columnSyncConfig').hidden = !enabled;
  $('#columnSyncConfig')
    .querySelectorAll('select')
    .forEach(input => {
      input.disabled = !enabled;
      input.required = enabled;
    });
  $('#columnSyncHint').textContent = enabled
    ? 'Kết quả sẽ được lưu trực tiếp vào cột ' + column.name + '.'
    : state.columnSyncInitial?.enabled
      ? 'Lưu để dừng đồng bộ và để trống toàn bộ cột ' + column.name + '.'
      : 'Bật để cấu hình lookup ngay trong cột này.';
  validateColumnSyncDraft();
  if ($('#columnSyncEnabled').disabled)
    $('#columnSyncHint').textContent = !lookupCloudAvailable
      ? 'Cần nơi lưu cấu hình trên Supabase để đồng bộ.'
      : 'Cột này có khóa hoặc ràng buộc nên không thể nhận lookup.';
  $('#columnSyncConfig')
    .querySelectorAll('select')
    .forEach(input => input._syncColumnSelect?.());
}
