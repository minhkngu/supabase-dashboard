import { toast } from './api.js';
import { fillOptions } from './lookup.js';
import { $, name, state } from './state.js';

export function initColumnFormula() {
  $('#columnFormulaEnabled').onchange = () => {
    if ($('#columnFormulaEnabled').checked && $('#columnSyncEnabled').checked) {
      $('#columnFormulaEnabled').checked = false;
      toast('Hãy tắt lookup trước khi bật formula.');
    }
    updateColumnFormula();
  };
  $('#columnFormulaField').onchange = () => {
    const field = $('#columnFormulaField').value;
    if (!field) return;
    const input = $('#columnFormulaExpression'),
      start = input.selectionStart ?? input.value.length,
      end = input.selectionEnd ?? start;
    input.setRangeText('[' + field + ']', start, end, 'end');
    input.focus();
    $('#columnFormulaField').value = '';
    $('#columnFormulaField')._syncColumnSelect?.();
  };
}

export function setupColumnFormula(spec) {
  const column = spec?.column,
    section = $('#columnFormulaSection');
  section.hidden = !column;
  if (!column) {
    state.formulaInitial = null;
    return;
  }
  const previous = (state.formulas || []).find(f => f.table === name(state.table) && f.column === column.name);
  const enabled = $('#columnFormulaEnabled');
  enabled.checked = !!previous?.enabled;
  const supported = /^(smallint|integer|bigint|numeric|decimal|real|double precision)$/.test(column.data_type);
  enabled.disabled =
    !supported ||
    !state.adminAvailable ||
    column.protected ||
    state.table.primary_keys.includes(column.name) ||
    column.options.some(o => ['generated', 'identity'].includes(o));
  $('#columnFormulaExpression').value = previous?.expression || '';
  fillOptions(
    $('#columnFormulaField'),
    state.table.columns
      .filter(
        c =>
          c.name !== column.name &&
          /^(smallint|integer|bigint|numeric|decimal|real|double precision)$/.test(c.data_type),
      )
      .map(c => c.name),
    'Chọn cột',
  );
  state.formulaInitial = {
    enabled: enabled.checked,
    expression: $('#columnFormulaExpression').value,
    table: name(state.table),
    column: column.name,
  };
  updateColumnFormula();
}
function updateColumnFormula() {
  const enabled = $('#columnFormulaEnabled').checked;
  $('#columnFormulaConfig').hidden = !enabled;
  $('#columnFormulaHint').textContent = $('#columnFormulaEnabled').disabled
    ? 'Formula chỉ dùng cho cột số có thể chỉnh sửa.'
    : enabled
      ? 'Giá trị được tính tự động trong Supabase.'
      : 'Tắt formula sẽ giữ các giá trị hiện có.';
  $('#columnFormulaField')._syncColumnSelect?.();
}
