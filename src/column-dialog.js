import { patchView, insertDuplicateColumn, renameViewColumn } from './grid/grid-state.js';
import { addFormula, setFormulas, setLookups } from './config-state.js';
import { setTables, setTable, setEnumTypes } from './metadata-state.js';
import { initColumnSync, setupColumnSync, columnSyncConfig, columnSyncSettingsSnapshot } from './column-sync.js';
import { initColumnFormula, setupColumnFormula } from './column-formula.js';
import { writeApi } from './write-api.js';
import { confirmDialog } from './confirm.js';
import { api, message, toast } from './api.js';
import { gridAction } from './events.js';
import { fillOptions, fillTableOptions, lookupTable, persistLookups } from './lookup.js';
import { nav, restoreSidebar } from './sidebar.js';
import { $, name, state } from './state.js';
import { displayedColumns, persistView, validFilterRules, validRules } from './view-menus.js';

async function refreshMetadata() {
  // Another serverless instance may still cache the schema from before a DDL write.
  const d = await api('/api/meta?refresh=1');
  state.adminAvailable = !!d.adminAvailable;
  state.adminError = d.adminError || '';
  setEnumTypes(Array.isArray(d.enumTypes) ? d.enumTypes : []);
  state.token = d.token;
  const current = state.table && name(state.table);
  setTables(d.tables);
  restoreSidebar();
  const selected = state.tables.find(t => name(t) === current);
  if (selected && state.view) {
    setTable(selected);
    patchView({
      filters: validFilterRules(state.view.filters, selected),
      groups: validRules(state.view.groups, selected),
      sorts: validRules(state.view.sorts, selected),
    });
    gridAction('render');
    persistView();
    nav();
    await gridAction('load', { silent: true });
  } else if (state.tables.length) gridAction('choose', state.tables[0]);
  else {
    setTable(null);
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
    $('#deleteColumn').disabled = c.delete_protected ?? !!protectedColumn;
    $('#columnTypeInfo').hidden = false;
    $('#columnTypeInfo').textContent = typeBlocked
      ? `Kiểu trong Supabase: ${actual}. Không thể đổi kiểu vì cột có ràng buộc hoặc phụ thuộc cần xử lý trước.`
      : protectedColumn
        ? `Kiểu trong Supabase: ${actual}. Có thể đổi kiểu sau khi kiểm tra dữ liệu; tên và việc xóa bị khóa vì đây là ${reasons.join(', ')}.`
        : `Kiểu hiện tại trong Supabase: ${actual}.`;
    if (c.options.includes('generated') && !$('#deleteColumn').disabled)
      $('#columnTypeInfo').textContent =
        `Cột công thức Supabase: ${c.default_value || actual}. Chỉ đọc; có thể xóa sau khi kiểm tra phụ thuộc và xác nhận.`;
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
  initColumnSync();
  initColumnFormula();
  $('#columnForm').onsubmit = async e => {
    e.preventDefault();
    $('#columnError').textContent = '';
    const spec = state.columnEdit,
      table = name(state.table);
    $('#saveColumn').disabled = true;
    try {
      if (spec) await saveColumnSteps(spec, table);
      else await addColumn(table);
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
      const changed = await schemaOperation({ ...source, action: 'duplicate', newName });
      if (!changed) return;
      if (state.table && name(state.table) === source.table) {
        await refreshMetadata();
        if (!state.table || name(state.table) !== source.table) return;
        insertDuplicateColumn('col:' + source.column, 'col:' + newName);
        persistView();
        gridAction('render');
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
  if (operation.action === 'delete' && preview.dependenciesChecked)
    msg += '\nĐã kiểm tra: không có thành phần phụ thuộc đang chặn xóa.';
  if (operation.action === 'delete' && preview.generatedExpression)
    msg += `\nCông thức Supabase: ${preview.generatedExpression}\nCông thức và toàn bộ giá trị của cột này sẽ bị xóa.`;
  if (
    operation.action === 'delete' &&
    !(await confirmDialog({ title: 'Xóa cột?', message: msg, confirmLabel: 'Xóa cột', danger: true }))
  )
    return false;
  await writeApi('/api/admin/schema/apply', {
    method: 'POST',
    body: JSON.stringify({ operation, signature: preview.signature }),
  });
  return true;
}
function migrateViewColumn(oldName, newName) {
  if (!state.view) return;
  renameViewColumn(oldName, newName);
  persistView();
}
function showColumnError(table, text) {
  if (state.table && name(state.table) === table) {
    $('#columnError').textContent = text;
    if (!$('#columnDialog').open) $('#columnDialog').showModal();
    requestAnimationFrame(() => $('#columnError').scrollIntoView({ block: 'nearest' }));
  }
  toast('Không thể lưu cột: ' + text);
}
async function addColumn(table) {
  $('#columnDialog').close();
  toast('Đang lưu thiết lập cột…');
  try {
    const changed = await schemaOperation({
      table,
      action: 'add',
      newName: $('#columnName').value.trim(),
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
    if (changed) {
      await refreshMetadata();
      toast('Đã cập nhật cột');
    }
  } catch (error) {
    showColumnError(table, error.message);
  }
}
function uniqueColumn(c) {
  return (
    (state.table.unique_constraints || []).some(u => u.columns?.length === 1 && u.columns[0] === c.name) ||
    (state.table.primary_keys?.length === 1 && state.table.primary_keys[0] === c.name)
  );
}
// Builds the ordered list of changes for an existing column: name, type,
// properties, then formula and lookup sync (turning one off before the other
// is turned on). Each step only reads the column name through `ctx`, which
// earlier steps update.
function columnSteps(spec, table, ctx) {
  const c = spec.column,
    label = $('#columnName').value.trim(),
    type = $('#columnType').value,
    steps = [];
  if (label !== c.name)
    steps.push({
      title: 'Đổi tên',
      schema: true,
      async run() {
        const lookup = state.lookups.find(
          x => x.sourceTable === table && x.columnBound === true && x.sync?.enabled && x.sync.columnName === c.name,
        );
        if (lookup) {
          const result = await writeApi('/api/lookup-sync/rename', {
            method: 'POST',
            body: JSON.stringify({ table, column: c.name, newName: label, id: lookup.id }),
          });
          setLookups(state.lookups.map(x => (x.id === lookup.id ? result.config : x)));
        } else await schemaOperation({ table, action: 'rename', column: c.name, newName: label });
        if (name(state.table) === table) migrateViewColumn(c.name, label);
        ctx.column = label;
      },
    });
  if (type && type !== '__current__')
    steps.push({
      title: 'Đổi kiểu',
      schema: true,
      run: () => schemaOperation({ table, action: 'type', column: ctx.column, newType: type }),
    });
  if (!$('#editColumnDefaultKind').disabled) {
    const options = {
      nullable: $('#editColumnNullable').checked,
      unique: $('#editColumnUnique').checked,
      defaultKind: $('#editColumnDefaultKind').value,
      defaultValue: $('#editColumnDefaultValue').value,
      description: $('#editColumnDescription').value,
    };
    if (
      options.nullable !== c.options.includes('nullable') ||
      options.unique !== !!uniqueColumn(c) ||
      options.defaultKind !== 'keep' ||
      options.description !== (c.description || '')
    )
      steps.push({
        title: 'Thuộc tính',
        schema: true,
        run: () => schemaOperation({ table, action: 'settings', column: ctx.column, options }),
      });
  }
  const formula = formulaStep(ctx),
    sync = syncStep(ctx);
  if (formula?.enables) steps.push(...[sync, formula].filter(Boolean));
  else steps.push(...[formula, sync].filter(Boolean));
  return steps;
}
function formulaStep(ctx) {
  const initial = state.formulaInitial;
  if (!initial || $('#columnFormulaEnabled').disabled) return null;
  const enabled = $('#columnFormulaEnabled').checked,
    expression = $('#columnFormulaExpression').value.trim();
  if (enabled === initial.enabled && (!enabled || expression === initial.expression)) return null;
  if (enabled && $('#columnSyncEnabled').checked) throw Error('Hãy tắt lookup trước khi bật formula.');
  return {
    title: enabled ? 'Formula' : 'Tắt formula',
    enables: enabled,
    async run() {
      const config = { table: initial.table, column: ctx.column, expression, enabled },
        result = await writeApi('/api/formula-config', { method: 'POST', body: JSON.stringify(config) });
      setFormulas(
        (state.formulas || []).filter(
          f => f.table !== config.table || ![initial.column, config.column].includes(f.column),
        ),
      );
      if (result.config?.enabled) addFormula(result.config);
      Object.assign(initial, { enabled, expression, column: config.column });
    },
  };
}
function syncStep(ctx) {
  const initial = state.columnSyncInitial;
  if (!initial || $('#columnSyncEnabled').disabled) return null;
  const enabled = $('#columnSyncEnabled').checked;
  if (enabled === initial.enabled && (!enabled || columnSyncSettingsSnapshot() === initial.draft)) return null;
  return {
    title: enabled ? 'Đồng bộ lookup' : 'Tắt đồng bộ lookup',
    async run() {
      const config = columnSyncConfig(ctx.column),
        preview = await api('/api/lookup-sync/preview', { method: 'POST', body: JSON.stringify(config) });
      const result = await writeApi('/api/lookup-config', {
          method: 'POST',
          body: JSON.stringify({ action: 'save', config, signature: preview.signature }),
        }),
        saved = result.config || config;
      setLookups(
        !enabled
          ? state.lookups.filter(x => x.id !== config.id)
          : state.lookups.some(x => x.id === config.id)
            ? state.lookups.map(x => (x.id === config.id ? saved : x))
            : [...state.lookups, saved],
      );
      persistLookups();
      Object.assign(initial, { enabled, previous: saved, draft: columnSyncSettingsSnapshot() });
    },
  };
}
// After schema steps the dialog must describe the column as it now is, so a
// retry only runs the steps that have not succeeded yet.
function syncDialogAfterSteps(spec, ctx, done) {
  const fresh = state.table?.columns.find(x => x.name === ctx.column);
  if (fresh) {
    state.columnEdit = { ...spec, id: `col:${fresh.name}`, column: fresh };
    $('#columnName').value = fresh.name;
  }
  if (done.includes('Đổi kiểu')) {
    const current = $('#columnType').querySelector('option[data-current-type]');
    if (current && fresh) current.textContent = `${fresh.format || fresh.data_type} — kiểu hiện tại`;
    $('#columnType').value = '__current__';
    $('#columnType')._syncColumnSelect?.();
  }
  if (done.includes('Thuộc tính')) {
    $('#editColumnDefaultKind').value = 'keep';
    $('#editColumnDefaultWrap').hidden = true;
    $('#editColumnDefaultKind')._syncColumnSelect?.();
  }
}
async function saveColumnSteps(spec, table) {
  const ctx = { column: spec.column.name };
  let steps;
  try {
    steps = columnSteps(spec, table, ctx);
  } catch (error) {
    $('#columnError').textContent = error.message;
    return;
  }
  $('#columnDialog').close();
  if (!steps.length) {
    toast('Không có thay đổi');
    return;
  }
  const done = [];
  let failure = null,
    stale = false;
  for (const [index, step] of steps.entries()) {
    // Formula and lookup steps check the live column, so reload metadata
    // after the schema steps that precede them.
    if (stale && !step.schema) {
      await refreshMetadata();
      syncDialogAfterSteps(spec, ctx, done);
      stale = false;
    }
    toast(`Đang lưu ${index + 1}/${steps.length}: ${step.title}…`);
    try {
      await step.run();
      done.push(step.title);
      stale ||= !!step.schema;
    } catch (error) {
      failure = { step, error };
      break;
    }
  }
  if (stale) await refreshMetadata();
  syncDialogAfterSteps(spec, ctx, done);
  if (state.table && name(state.table) === table) {
    gridAction('render');
    await gridAction('load', { silent: true });
  }
  if (!failure) {
    toast(steps.length === 1 ? `Đã lưu: ${done[0]}` : `Đã lưu ${steps.length} thay đổi: ${done.join(', ')}`);
    return;
  }
  const rest = steps.slice(done.length + 1).map(step => step.title);
  showColumnError(
    table,
    [
      done.length ? `Đã xong: ${done.join(', ')}.` : '',
      `Lỗi ở bước “${failure.step.title}”: ${failure.error.message}`,
      rest.length ? `Chưa chạy: ${rest.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
let duplicateColumnSource = null;
