import { api, message, toast } from './api.js';
import { choose, load, render } from './grid/render.js';
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
  persistLookups,
} from './lookup.js';
import { nav, restoreSidebar } from './sidebar.js';
import { $, el, name, state } from './state.js';
import { displayedColumns, persistView, validFilterRules, validRules } from './view-menus.js';

async function refreshMetadata() {
  const d = await api('/api/meta');
  state.adminAvailable = !!d.adminAvailable;
  state.adminError = d.adminError || '';
  state.enumTypes = Array.isArray(d.enumTypes) ? d.enumTypes : [];
  state.token = d.token;
  const current = state.table && name(state.table);
  state.tables = d.tables;
  restoreSidebar();
  const selected = state.tables.find(t => name(t) === current);
  if (selected && state.view) {
    state.table = selected;
    state.view.filters = validFilterRules(state.view.filters, selected);
    state.view.groups = validRules(state.view.groups, selected);
    state.view.sorts = validRules(state.view.sorts, selected);
    render();
    persistView();
    nav();
    await load({ silent: true });
  } else if (state.tables.length) choose(state.tables[0]);
  else {
    state.table = null;
    message('Không có bảng nào để hiển thị.');
  }
  return d;
}
function updateColumnForm() {
  const editing = state.columnEdit;
  $('#columnCreateOptions').hidden = !!editing;
  $('#columnEditDetails').hidden = !editing;
  $('#columnEnumWrap').hidden = !!editing || $('#columnType').value !== 'enum';
}
export function openColumnDialog(spec) {
  if (!state.configReady) {
    toast('Đang tải cấu hình cột.');
    return;
  }
  if ($('#saveColumn').disabled) {
    toast('Đang lưu thiết lập cột.');
    return;
  }
  if (!state.adminAvailable) {
    toast(state.adminError || 'Cần cấu hình kết nối database.');
    return;
  }
  state.columnEdit = spec || null;
  $('#columnForm').reset();
  $('#columnType').querySelector('option[data-current-type]')?.remove();
  $('#columnName').disabled = false;
  $('#columnType').disabled = false;
  $('#deleteColumn').disabled = false;
  $('#columnTypeInfo').hidden = true;
  $('#columnTypeInfo').textContent = '';
  fillOptions($('#columnEnum'), state.enumTypes, 'Chọn kiểu enum');
  fillTableOptions($('#columnForeignTable'), 'Không có');
  fillOptions($('#columnForeignColumn'), [], 'Chọn cột');
  $('#columnNullable').disabled = false;
  $('#columnDefaultValueWrap').hidden = true;
  $('#columnError').textContent = '';
  const editing = !!spec;
  $('#columnDialogTitle').textContent = editing ? 'Thiết lập cột' : 'Thêm cột';
  $('#deleteColumn').hidden = !editing;
  $('#duplicateColumn').hidden = !spec?.column;
  if (editing) {
    const c = spec.column;
    $('#columnName').value = c.name;
    const actual = c.format || c.data_type || 'Không xác định',
      option = new Option(actual + ' — kiểu hiện tại', '__current__');
    option.dataset.currentType = 'true';
    $('#columnType').prepend(option);
    $('#columnType').value = '__current__';
    const reasons = [];
    if (state.table.primary_keys?.includes(c.name)) reasons.push('khóa chính');
    if (c.options.includes('generated')) reasons.push('cột tự sinh');
    if (c.options.includes('identity')) reasons.push('cột identity');
    if (c.protected && !reasons.length) reasons.push('có ràng buộc, chỉ mục hoặc phụ thuộc');
    const isUnique =
      (state.table.unique_constraints || []).some(u => u.columns?.length === 1 && u.columns[0] === c.name) ||
      (state.table.primary_keys?.length === 1 && state.table.primary_keys[0] === c.name);
    $('#editColumnDescription').value = c.description || '';
    $('#editColumnNullable').checked = c.options.includes('nullable');
    $('#editColumnUnique').checked = !!isUnique;
    $('#editColumnDefaultKind').value = 'keep';
    $('#editColumnDefaultCurrent').textContent = `Hiện tại: ${c.default_value || 'không có'}`;
    $('#editColumnDefaultWrap').hidden = true;
    const settingsBlocked = c.options.includes('generated') || c.options.includes('identity');
    for (const id of ['editColumnDescription', 'editColumnNullable', 'editColumnUnique', 'editColumnDefaultKind'])
      $('#' + id).disabled = settingsBlocked;
    const protectedColumn = c.protected || reasons.length > 0;
    const typeBlocked =
      c.type_protected === undefined
        ? (protectedColumn && !state.table.primary_keys?.includes(c.name)) ||
          c.options.includes('identity') ||
          c.options.includes('generated')
        : c.type_protected;
    $('#columnName').disabled = !!protectedColumn;
    $('#columnType').disabled = !!typeBlocked;
    $('#deleteColumn').disabled = !!protectedColumn;
    $('#columnTypeInfo').hidden = false;
    $('#columnTypeInfo').textContent = typeBlocked
      ? `Kiểu trong Supabase: ${actual}. Không thể đổi kiểu vì cột có ràng buộc hoặc phụ thuộc cần xử lý trước.`
      : protectedColumn
        ? `Kiểu trong Supabase: ${actual}. Có thể đổi kiểu sau khi kiểm tra dữ liệu; tên và việc xóa bị khóa vì đây là ${reasons.join(', ')}.`
        : `Kiểu hiện tại trong Supabase: ${actual}.`;
    updateColumnForm();
  } else updateColumnForm();
  setupColumnSync(spec);
  setupColumnFormula(spec);
  $('#columnDialog').showModal();
  $('#columnDialog')
    .querySelectorAll('select')
    .forEach(select => select._syncColumnSelect?.());
}
export function initColumnDialog() {
  $('#editColumnDefaultKind').onchange = () => {
    $('#editColumnDefaultWrap').hidden = !['literal', 'expression'].includes($('#editColumnDefaultKind').value);
  };
  $('#columnForeignTable').onchange = () => {
    const t = lookupTable($('#columnForeignTable').value);
    fillOptions($('#columnForeignColumn'), t?.columns.map(c => c.name) || [], 'Chọn cột');
  };
  $('#columnType').onchange = updateColumnForm;
  $('#columnIdentity').onchange = () => {
    const on = $('#columnIdentity').checked;
    $('#columnNullable').disabled = on;
    if (on) $('#columnNullable').checked = false;
  };
  $('#columnDefaultKind').onchange = () => {
    $('#columnDefaultValueWrap').hidden = !['literal', 'expression'].includes($('#columnDefaultKind').value);
  };
  $('#closeColumnDialog').onclick = $('#cancelColumn').onclick = () => $('#columnDialog').close();
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
  $('#columnForm').onsubmit = async e => {
    e.preventDefault();
    $('#columnError').textContent = '';
    const label = $('#columnName').value.trim(),
      spec = state.columnEdit,
      table = name(state.table);
    $('#saveColumn').disabled = true;
    $('#columnDialog').close();
    toast('Đang lưu thiết lập cột…');
    try {
      const formula = await saveColumnFormula();
      if (formula !== false) return;
      const synced = await saveColumnSync();
      if (synced !== false) return;
      let changed = false;
      if (!spec)
        changed = await schemaOperation({
          table,
          action: 'add',
          newName: label,
          newType: $('#columnType').value,
          options: {
            nullable: $('#columnNullable').checked,
            unique: $('#columnUnique').checked,
            identity: $('#columnIdentity').checked,
            array: $('#columnArray').checked,
            enumType: $('#columnEnum').value,
            foreignTable: $('#columnForeignTable').value,
            foreignColumn: $('#columnForeignColumn').value,
            onDelete: $('#columnForeignDelete').value,
            onUpdate: $('#columnForeignUpdate').value,
            defaultKind: $('#columnDefaultKind').value,
            defaultValue: $('#columnDefaultValue').value,
            description: $('#columnDescription').value,
          },
        });
      else {
        const c = spec.column,
          type = $('#columnType').value,
          typeChanged = type && type !== '__current__';
        const originalUnique =
          (state.table.unique_constraints || []).some(u => u.columns?.length === 1 && u.columns[0] === c.name) ||
          (state.table.primary_keys?.length === 1 && state.table.primary_keys[0] === c.name);
        const settingsChanged =
          !$('#editColumnDefaultKind').disabled &&
          ($('#editColumnNullable').checked !== c.options.includes('nullable') ||
            $('#editColumnUnique').checked !== !!originalUnique ||
            $('#editColumnDefaultKind').value !== 'keep' ||
            $('#editColumnDescription').value !== (c.description || ''));
        if ((label !== c.name || typeChanged) && settingsChanged)
          throw Error('Hãy đổi tên hoặc kiểu cột và các thuộc tính trong hai lần lưu riêng.');
        if (label !== c.name && typeChanged) throw Error('Hãy đổi tên và đổi kiểu trong hai lần riêng.');
        if (label !== c.name) {
          const lookup = state.lookups.find(
            x => x.sourceTable === table && x.columnBound === true && x.sync?.enabled && x.sync.columnName === c.name,
          );
          if (lookup) {
            const result = await api('/api/lookup-sync/rename', {
              method: 'POST',
              body: JSON.stringify({ table, column: c.name, newName: label, id: lookup.id }),
            });
            state.lookups = state.lookups.map(x => (x.id === lookup.id ? result.config : x));
            changed = true;
          } else changed = await schemaOperation({ table, action: 'rename', column: c.name, newName: label });
          if (changed && name(state.table) === table) migrateViewColumn(c.name, label);
        } else if (typeChanged)
          changed = await schemaOperation({ table, action: 'type', column: c.name, newType: type });
        else if (!$('#editColumnDefaultKind').disabled) {
          const options = {
            nullable: $('#editColumnNullable').checked,
            unique: $('#editColumnUnique').checked,
            defaultKind: $('#editColumnDefaultKind').value,
            defaultValue: $('#editColumnDefaultValue').value,
            description: $('#editColumnDescription').value,
          };
          const currentUnique =
            (state.table.unique_constraints || []).some(u => u.columns?.length === 1 && u.columns[0] === c.name) ||
            (state.table.primary_keys?.length === 1 && state.table.primary_keys[0] === c.name);
          if (
            options.nullable !== c.options.includes('nullable') ||
            options.unique !== !!currentUnique ||
            options.defaultKind !== 'keep' ||
            options.description !== (c.description || '')
          )
            changed = await schemaOperation({ table, action: 'settings', column: c.name, options });
        }
      }
      if (changed) {
        $('#columnDialog').close();
        await refreshMetadata();
        toast('Đã cập nhật cột');
      }
    } catch (error) {
      if (state.table && name(state.table) === table && !$('#columnDialog').open) {
        $('#columnError').textContent = error.message;
        $('#columnDialog').showModal();
        toast('Không thể lưu cột: ' + error.message);
        requestAnimationFrame(() => $('#columnError').scrollIntoView({ block: 'nearest' }));
      } else toast('Không thể lưu cột: ' + error.message);
    } finally {
      $('#saveColumn').disabled = false;
    }
  };
  $('#duplicateColumn').onclick = () => {
    const column = state.columnEdit?.column;
    if (!column || !state.table || !state.configReady) return;
    duplicateColumnSource = { table: name(state.table), column: column.name };
    const base = (column.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_') || 'column').slice(0, 55);
    let next = base + '_copy',
      i = 2;
    const names = new Set(displayedColumns(true).map(s => s.column?.name || s.lookup?.label));
    while (names.has(next)) next = base + '_copy_' + i++;
    $('#duplicateColumnName').value = next;
    $('#duplicateColumnError').textContent = '';
    $('#duplicateColumnHint').textContent = `Cột nguồn: ${column.name} · ${column.format || column.data_type}`;
    $('#columnDialog').close();
    $('#duplicateColumnDialog').showModal();
    $('#duplicateColumnName').focus();
    $('#duplicateColumnName').select();
  };
  $('#closeDuplicateColumn').onclick = $('#cancelDuplicateColumn').onclick = () => $('#duplicateColumnDialog').close();
  $('#duplicateColumnForm').onsubmit = async event => {
    event.preventDefault();
    if (!duplicateColumnSource || $('#saveDuplicateColumn').disabled) return;
    const source = { ...duplicateColumnSource },
      newName = $('#duplicateColumnName').value.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(newName)) {
      $('#duplicateColumnError').textContent = 'Tên cột chỉ gồm chữ, số và dấu gạch dưới.';
      return;
    }
    $('#saveDuplicateColumn').disabled = true;
    $('#duplicateColumnError').textContent = '';
    $('#duplicateColumnDialog').close();
    try {
      await schemaOperation({ ...source, action: 'duplicate', newName });
      if (state.table && name(state.table) === source.table) {
        await refreshMetadata();
        if (!state.table || name(state.table) !== source.table) return;
        const order = state.view.order,
          copy = 'col:' + newName,
          original = 'col:' + source.column;
        const current = order.indexOf(copy);
        if (current >= 0) order.splice(current, 1);
        order.splice(Math.max(0, order.indexOf(original) + 1), 0, copy);
        persistView();
        render();
      }
      toast('Đã nhân bản cột ' + source.column);
    } catch (error) {
      $('#duplicateColumnError').textContent = error.message;
      toast('Không thể nhân bản cột: ' + error.message);
      if (!document.querySelector('dialog[open]')) $('#duplicateColumnDialog').showModal();
    } finally {
      $('#saveDuplicateColumn').disabled = false;
    }
  };
  $('#deleteColumn').onclick = async () => {
    const spec = state.columnEdit;
    if (!spec) return;
    $('#columnError').textContent = '';
    $('#deleteColumn').disabled = true;
    try {
      let changed;
      changed = await schemaOperation({ table: name(state.table), action: 'delete', column: spec.column.name });
      if (changed) {
        $('#columnDialog').close();
        await refreshMetadata();
        toast('Đã xóa cột');
      }
    } catch (error) {
      $('#columnError').textContent = error.message;
    } finally {
      $('#deleteColumn').disabled = false;
    }
  };
}

async function schemaOperation(operation) {
  const preview = await api('/api/admin/schema/preview', { method: 'POST', body: JSON.stringify(operation) });
  const action = {
    add: 'Thêm cột',
    duplicate: 'Nhân bản cột',
    rename: 'Đổi tên cột',
    type: 'Đổi kiểu cột',
    settings: 'Thay đổi thuộc tính cột',
    delete: 'Xóa cột',
  }[operation.action];
  let msg = `${action} trong ${operation.table}? Thay đổi trực tiếp cấu trúc Supabase và có thể ảnh hưởng ứng dụng khác.`;
  if (operation.column) msg += `\nCột: ${operation.column}`;
  if (operation.newName) msg += `\nTên mới: ${operation.newName}`;
  if (operation.newType) msg += `\nKiểu: ${operation.newType}`;
  if (operation.action === 'add' && operation.options) {
    const o = operation.options;
    msg += `\nCho phép null: ${o.nullable ? 'Có' : 'Không'} · Duy nhất: ${o.unique ? 'Có' : 'Không'} · Identity: ${o.identity ? 'Có' : 'Không'} · Mảng: ${o.array ? 'Có' : 'Không'}\nMặc định: ${['literal', 'expression'].includes(o.defaultKind) ? o.defaultValue : o.defaultKind}`;
    if (o.description) msg += `\nMô tả: ${o.description}`;
    if (o.foreignTable)
      msg += `\nKhóa ngoại: ${o.foreignTable}.${o.foreignColumn} · Khi xóa: ${o.onDelete} · Khi sửa: ${o.onUpdate}`;
  }
  if (['delete', 'type'].includes(operation.action))
    msg += `\nGiá trị hiện có: ${preview.affected}. ${operation.action === 'delete' ? 'Dữ liệu trong cột sẽ bị xóa.' : 'Hãy kiểm tra các ứng dụng đang sử dụng cột này.'}`;
  if (operation.action === 'delete' && !confirm(msg)) return false;
  await api('/api/admin/schema/apply', {
    method: 'POST',
    body: JSON.stringify({ operation, signature: preview.signature }),
  });
  return true;
}
function migrateViewColumn(oldName, newName) {
  const v = state.view;
  if (!v) return;
  for (const rules of [v.filters, v.groups, v.sorts])
    for (const r of rules || []) if (r.column === oldName) r.column = newName;
  for (const list of [v.order, v.frozen, v.hidden])
    for (let i = 0; i < (list || []).length; i++) if (list[i] === 'col:' + oldName) list[i] = 'col:' + newName;
  if (v.widths && Object.hasOwn(v.widths, 'col:' + oldName)) {
    v.widths['col:' + newName] = v.widths['col:' + oldName];
    delete v.widths['col:' + oldName];
  }
  persistView();
}
function columnSettingsSnapshot() {
  return JSON.stringify(
    [
      'columnName',
      'columnType',
      'editColumnNullable',
      'editColumnUnique',
      'editColumnDescription',
      'editColumnDefaultKind',
      'editColumnDefaultValue',
    ].map(id => {
      const input = $('#' + id);
      return input.type === 'checkbox' ? input.checked : input.value;
    }),
  );
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
function columnSyncSettingsSnapshot() {
  return JSON.stringify({
    table: $('#columnSyncTable').value,
    field: $('#columnSyncField').value,
    mode: $('#columnSyncMode').value,
    display: $('#columnSyncDisplay').value,
    conditions: columnSyncDraft,
  });
}
function setupColumnSync(spec) {
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
    snapshot: columnSettingsSnapshot(),
    draft: columnSyncSettingsSnapshot(),
  };
  updateColumnSync();
}
function columnSyncConfig() {
  const column = state.columnEdit?.column,
    initial = state.columnSyncInitial,
    enabled = $('#columnSyncEnabled').checked;
  if (!column || !initial) throw Error('Không tìm thấy cột nhận lookup.');
  if (!enabled) return { ...initial.previous, sync: { enabled: false, columnName: column.name }, columnBound: true };
  const conditions = columnSyncDraft.map(r => ({ ...r }));
  const config = {
    id: initial.id,
    label: column.name,
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
    sync: { enabled: true, columnName: column.name },
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
function setupColumnFormula(spec) {
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
    snapshot: columnSettingsSnapshot(),
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
async function saveColumnFormula() {
  const initial = state.formulaInitial;
  if (!initial || $('#columnFormulaEnabled').disabled) return false;
  const enabled = $('#columnFormulaEnabled').checked,
    expression = $('#columnFormulaExpression').value.trim();
  if (enabled === initial.enabled && (!enabled || expression === initial.expression)) return false;
  if (initial.snapshot !== columnSettingsSnapshot())
    throw Error('Hãy lưu thuộc tính cột và formula trong hai lần riêng.');
  if (
    state.columnSyncInitial &&
    ($('#columnSyncEnabled').checked !== state.columnSyncInitial.enabled ||
      ($('#columnSyncEnabled').checked && columnSyncSettingsSnapshot() !== state.columnSyncInitial.draft))
  )
    throw Error('Hãy lưu lookup và formula trong hai lần riêng.');
  if (enabled && $('#columnSyncEnabled').checked) throw Error('Hãy tắt lookup trước khi bật formula.');
  const config = { table: initial.table, column: initial.column, expression, enabled },
    result = await api('/api/formula-config', { method: 'POST', body: JSON.stringify(config) });
  state.formulas = (state.formulas || []).filter(f => f.table !== config.table || f.column !== config.column);
  if (result.config?.enabled) state.formulas.push(result.config);
  if (state.table && name(state.table) === config.table) {
    render();
    await load({ silent: true });
  }
  toast(enabled ? 'Đã lưu formula' : 'Đã tắt formula');
  return true;
}
async function saveColumnSync() {
  const initial = state.columnSyncInitial;
  if (!initial || $('#columnSyncEnabled').disabled) return false;
  const enabled = $('#columnSyncEnabled').checked;
  if (enabled === initial.enabled && (!enabled || columnSyncSettingsSnapshot() === initial.draft)) return false;
  if (initial.snapshot !== columnSettingsSnapshot())
    throw Error('Hãy lưu thay đổi thuộc tính cột và đồng bộ lookup trong hai lần riêng.');
  const config = columnSyncConfig(),
    preview = await api('/api/lookup-sync/preview', { method: 'POST', body: JSON.stringify(config) });
  const result = await api('/api/lookup-config', {
      method: 'POST',
      body: JSON.stringify({ action: 'save', config, signature: preview.signature }),
    }),
    saved = result.config || config;
  state.lookups = !enabled
    ? state.lookups.filter(x => x.id !== config.id)
    : state.lookups.some(x => x.id === config.id)
      ? state.lookups.map(x => (x.id === config.id ? saved : x))
      : [...state.lookups, saved];
  persistLookups();
  $('#columnDialog').close();
  await load({ silent: true });
  toast(enabled ? 'Đã lưu lookup cho cột' : 'Đã để trống cột');
  return true;
}
let duplicateColumnSource = null;
