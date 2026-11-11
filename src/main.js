import { api, message, toast } from './api.js';
import { deleteRecords, refreshAfterWrite, rowCheckbox, rowSelectionHeader, updateRowSelection } from './deletion.js';
import { editableCell, formatNumber, formatNumberInput } from './grid/cell-edit.js';
import { historyFor, updateHistoryButtons } from './history.js';
import {
  activeLookups,
  checkLookupSync,
  configValid,
  fillOptions,
  fillTableOptions,
  loadLookups,
  lookupCell,
  lookupCloudAvailable,
  lookupConditions,
  lookupTable,
  lookupType,
  persistLookups,
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
function openColumnDialog(spec) {
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
export function initMain() {
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
  $('#columnsButton').onclick = () => {
    const menu = $('#columnsMenu'),
      open = menu.hidden;
    closeViewMenus();
    if (open && state.table) {
      const searchInput = $('#columnSearchInput');
      if (searchInput) searchInput.value = '';
      renderColumnVisibility();
      menu.hidden = false;
      $('#columnsButton').setAttribute('aria-expanded', 'true');
      if (searchInput) setTimeout(() => searchInput.focus(), 50);
    }
  };
  if (showAllBtn) {
    showAllBtn.onclick = () => {
      state.view.hidden = [];
      persistView();
      render();
      renderColumnVisibility($('#columnSearchInput')?.value || '');
    };
  }
  if (colSearch) {
    colSearch.oninput = () => renderColumnVisibility(colSearch.value);
    colSearch.onclick = e => e.stopPropagation();
  }
  enhanceSelects(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) enhanceSelects(node);
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', closeAllCustomSelects));

  for (const kind of ['filter', 'group', 'sort']) {
    const btn = $('#' + kind + 'Button');
    if (btn)
      btn.onclick = () => {
        const menu = $('#' + kind + 'Menu'),
          open = menu.hidden;
        closeViewMenus();
        if (open) {
          renderViewMenu(kind);
          menu.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
        }
      };
    const addBtn = $('#add' + (kind === 'filter' ? 'Filter' : kind === 'group' ? 'Group' : 'Sort'));
    if (addBtn)
      addBtn.onclick = () => {
        if (kind === 'filter') {
          if (!state.table || !state.table.columns.length) return;
          state.view.filters = state.view.filters || [];
          state.view.filters.push({ column: state.table.columns[0].name, operator: 'contains', value: '' });
          applyRules('filter');
        } else {
          const rules = kind === 'group' ? state.view.groups : state.view.sorts;
          const c = state.table.columns.find(
            c =>
              !/json|array|bytea/i.test(c.data_type) &&
              !c.data_type.startsWith('_') &&
              !rules.some(r => r.column === c.name),
          );
          if (c) {
            rules.push({ column: c.name, direction: 'asc' });
            applyRules(kind);
          }
        }
      };
  }
  if (clearFiltersBtn)
    clearFiltersBtn.onclick = () => {
      state.view.filters = [];
      applyRules('filter');
    };

  document.addEventListener('pointerdown', e => {
    const path = e.composedPath ? e.composedPath() : [];
    const inside =
      path.some(
        el =>
          el instanceof Element &&
          (el.closest?.('.view-menu') ||
            el.closest?.('.custom-select-menu') ||
            el.classList?.contains('custom-select-menu') ||
            el.classList?.contains('custom-select-item')),
      ) ||
      e.target.closest?.('.view-menu') ||
      e.target.closest?.('.custom-select-menu');

    if (!inside) {
      closeViewMenus();
    } else if (!e.target.closest?.('.custom-select-wrap')) {
      closeAllCustomSelects();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAllCustomSelects();
      const open = ['filter', 'group', 'sort', 'columns'].find(k => $('#' + k + 'Menu') && !$('#' + k + 'Menu').hidden);
      if (open) {
        closeViewMenus();
        $('#' + open + 'Button')?.focus();
      }
    }
  });
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

const viewStorageKey = 'siris-views-v1';
function restoreViews() {
  try {
    const data = JSON.parse(localStorage.getItem(viewStorageKey) || '{}');
    state.views = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    state.views = {};
  }
}
function validFilterRules(rules, table) {
  const columns = new Set(table.columns.map(c => c.name)),
    validOps = ['contains', 'equals', 'neq', 'startswith', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];
  return (Array.isArray(rules) ? rules : [])
    .filter(r => r && columns.has(r.column))
    .map(r => ({
      column: r.column,
      operator: validOps.includes(r.operator) ? r.operator : 'contains',
      value: r.value != null ? String(r.value) : '',
    }));
}
function validRules(rules, table) {
  const columns = new Set(
      table.columns
        .filter(c => !/json|array|bytea/i.test(c.data_type) && !c.data_type.startsWith('_'))
        .map(c => c.name),
    ),
    seen = new Set();
  return (Array.isArray(rules) ? rules : [])
    .filter(
      r =>
        r &&
        columns.has(r.column) &&
        ['asc', 'desc'].includes(r.direction) &&
        !seen.has(r.column) &&
        seen.add(r.column),
    )
    .map(r => ({ column: r.column, direction: r.direction }));
}
function currentView() {
  return state.view;
}
export function persistView() {
  if (!state.table || !state.view) return;
  state.view.search = $('#search').value;
  state.view.freezeDefaultInitialized = true;
  state.view.page = state.page;
  state.view.collapsed = [...state.collapsed];
  state.views[name(state.table)] = state.view;
  try {
    localStorage.setItem(viewStorageKey, JSON.stringify(state.views));
    localStorage.setItem('siris-current-table', name(state.table));
  } catch {
    toast('Không thể lưu cấu hình trên trình duyệt');
  }
}
function displayedColumns(includeHidden = false) {
  const all = [
      ...state.table.columns.map(c => ({ id: `col:${c.name}`, column: c })),
      ...activeLookups()
        .filter(x => !x.sync?.enabled && !x.columnBound)
        .map(x => ({ id: `lookup:${x.id}`, lookup: x })),
    ],
    byId = new Map(all.map(x => [x.id, x])),
    v = currentView();
  const ids = [...new Set([...(v.order || []).filter(id => byId.has(id)), ...all.map(x => x.id)])];
  v.frozen = [...new Set((v.frozen || []).filter(id => byId.has(id)))];
  v.order = ids;
  v.hidden = [...new Set((v.hidden || []).filter(id => byId.has(id)))];
  return [...ids.filter(id => v.frozen.includes(id)), ...ids.filter(id => !v.frozen.includes(id))]
    .filter(id => includeHidden || !v.hidden.includes(id))
    .map(id => byId.get(id));
}
function setVisibleOrder(ids) {
  const present = new Set(ids);
  let i = 0;
  state.view.order = state.view.order.map(id => (present.has(id) ? ids[i++] : id));
}
function moveColumnInList(from, to, after = false) {
  const columns = displayedColumns(true).map(spec => spec.id),
    frozen = state.view.frozen;
  if (from === to || !columns.includes(from) || !columns.includes(to)) return false;
  if (frozen.includes(from) !== frozen.includes(to)) {
    toast('Ghim hoặc bỏ ghim cột trước khi chuyển vị trí này');
    return false;
  }
  columns.splice(columns.indexOf(from), 1);
  columns.splice(columns.indexOf(to) + (after ? 1 : 0), 0, from);
  setVisibleOrder(columns);
  persistView();
  render();
  return true;
}
function renderColumnVisibility(filterQuery = '') {
  const list = $('#columnVisibility');
  if (!list) return;
  list.replaceChildren();
  const query = (filterQuery || '').trim().toLowerCase();
  const allColumns = displayedColumns(true);
  const filtered = query
    ? allColumns.filter(c => {
        const label = (c.column?.name || c.lookup?.label || '').toLowerCase();
        return label.includes(query);
      })
    : allColumns;

  if (!filtered.length) {
    list.append(el('div', 'columns-empty-text', 'Không tìm thấy cột phù hợp'));
    return;
  }

  for (const spec of filtered) {
    const row = el('label', 'column-visibility-item');
    row.draggable = true;
    const handle = el('span', 'column-reorder-handle', '⠿');
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `Sắp xếp cột ${spec.column?.name || spec.lookup?.label}`);
    handle.title = 'Kéo hoặc dùng phím mũi tên để sắp xếp';
    handle.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    handle.onkeydown = e => {
      if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const items = displayedColumns(true),
        index = items.findIndex(item => item.id === spec.id),
        target = items[index + (e.key === 'ArrowUp' ? -1 : 1)];
      if (target && moveColumnInList(spec.id, target.id, e.key === 'ArrowDown')) {
        renderColumnVisibility($('#columnSearchInput')?.value || '');
        [...list.querySelectorAll('.column-reorder-handle')]
          .find(item => item.getAttribute('aria-label') === handle.getAttribute('aria-label'))
          ?.focus();
      }
    };
    row.ondragstart = e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-siris-column-list', spec.id);
      row.classList.add('column-list-dragging');
    };
    row.ondragend = () => {
      row.classList.remove('column-list-dragging');
      list
        .querySelectorAll('.column-list-before,.column-list-after')
        .forEach(item => item.classList.remove('column-list-before', 'column-list-after'));
    };
    row.ondragover = e => {
      if (!e.dataTransfer.types.includes('application/x-siris-column-list')) return;
      e.preventDefault();
      list
        .querySelectorAll('.column-list-before,.column-list-after')
        .forEach(item => item.classList.remove('column-list-before', 'column-list-after'));
      row.classList.add(
        e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'column-list-after' : 'column-list-before',
      );
    };
    row.ondrop = e => {
      e.preventDefault();
      e.stopPropagation();
      const from = e.dataTransfer.getData('application/x-siris-column-list'),
        after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      if (moveColumnInList(from, spec.id, after))
        setTimeout(() => renderColumnVisibility($('#columnSearchInput')?.value || ''), 0);
    };
    const isVisible = !state.view.hidden.includes(spec.id);
    if (isVisible) row.classList.add('is-active');

    const switchWrap = el('span', 'column-switch-wrap');
    const box = el('input', 'column-switch-input');
    box.type = 'checkbox';
    box.checked = isVisible;
    const slider = el('span', 'column-switch-slider');
    switchWrap.append(box, slider);

    let icon = 'T',
      typeClass = 't';
    if (spec.lookup) {
      icon = '↗';
      typeClass = 'key';
    } else if (spec.column) {
      const col = spec.column;
      if (state.table?.primary_keys?.includes(col.name)) {
        icon = '🔑';
        typeClass = 'key';
      } else if (col.data_type === 'boolean') {
        icon = 'B';
        typeClass = 'bool';
      } else if (/int|numeric|decimal|real|double/.test(col.data_type)) {
        icon = '#';
        typeClass = 'num';
      } else if (/date|time/.test(col.data_type)) {
        icon = '◷';
        typeClass = 'date';
      } else if (col.data_type === 'jsonb' || col.data_type === 'json') {
        icon = '{}';
        typeClass = 'json';
      }
    }
    const badge = el('span', 'type-pill type-' + typeClass, icon);
    const nameText = spec.column?.name || spec.lookup?.label;
    const nameSpan = el('span', 'column-item-name', nameText);

    box.onchange = () => {
      if (!box.checked && displayedColumns().length <= 1) {
        box.checked = true;
        toast('Cần giữ ít nhất một cột hiển thị.');
        return;
      }
      state.view.hidden = box.checked
        ? state.view.hidden.filter(id => id !== spec.id)
        : [...state.view.hidden, spec.id];
      persistView();
      clearBulk();
      render();
      row.classList.toggle('is-active', box.checked);
    };

    row.append(handle, switchWrap, badge, nameSpan);
    list.append(row);
  }
}
const showAllBtn = $('#showAllColumns');
const colSearch = $('#columnSearchInput');
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select-menu:not([hidden])').forEach(m => {
    m.hidden = true;
    const btn = m.closest('.custom-select-wrap')?.querySelector('.custom-select-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}
export function closeViewMenus() {
  closeAllCustomSelects();
  for (const kind of ['filter', 'group', 'sort', 'columns']) {
    const m = $('#' + kind + 'Menu'),
      b = $('#' + kind + 'Button');
    if (m) m.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
  }
}

export function createCustomSelect({ options, value, onChange, ariaLabel, searchPlaceholder, className = '' }) {
  const wrap = el('div', 'custom-select-wrap ' + (className || ''));
  const btn = el('button', 'custom-select-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', ariaLabel || 'Lựa chọn');
  btn.setAttribute('aria-expanded', 'false');
  const labelWrap = el('div', 'custom-select-label-wrap');
  const chevron = el('span', 'custom-select-chevron', '▾');
  btn.append(labelWrap, chevron);
  const menu = el('div', 'custom-select-menu');
  menu.hidden = true;
  let currentVal = value;
  let currentOptions = [...options];

  function updateButtonDisplay() {
    labelWrap.replaceChildren();
    const selected = currentOptions.find(o => o.value === currentVal) || currentOptions[0];
    if (selected) {
      if (selected.pill) labelWrap.append(el('span', 'type-pill type-' + (selected.pillType || 't'), selected.pill));
      labelWrap.append(el('span', 'custom-select-label', selected.label));
    }
  }

  const list = el('div', 'custom-select-list');
  function renderList(query = '') {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const filtered = q
      ? currentOptions.filter(
          o =>
            o.label.toLowerCase().includes(q) ||
            (o.sub && o.sub.toLowerCase().includes(q)) ||
            (o.group && o.group.toLowerCase().includes(q)),
        )
      : currentOptions;
    if (!filtered.length) {
      list.append(el('div', 'custom-select-item is-disabled', 'Không tìm thấy'));
      return;
    }
    let previousGroup = '';
    filtered.forEach(opt => {
      if (opt.group && opt.group !== previousGroup) {
        const heading = el('div', 'custom-select-group', opt.group);
        heading.setAttribute('role', 'presentation');
        list.append(heading);
      }
      previousGroup = opt.group || '';
      const item = el(
        'div',
        'custom-select-item' + (opt.value === currentVal ? ' is-selected' : '') + (opt.disabled ? ' is-disabled' : ''),
      );
      item.role = 'option';
      item.tabIndex = opt.disabled ? -1 : 0;
      item.setAttribute('aria-selected', String(opt.value === currentVal));
      if (opt.pill) item.append(el('span', 'type-pill type-' + (opt.pillType || 't'), opt.pill));
      item.append(el('span', 'custom-select-item-text', opt.label));
      if (opt.sub) item.append(el('span', 'custom-select-item-type', opt.sub));
      if (opt.value === currentVal) item.append(el('span', 'custom-select-item-check', '✓'));
      if (!opt.disabled) {
        item.onclick = e => {
          e.stopPropagation();
          currentVal = opt.value;
          updateButtonDisplay();
          menu.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          btn.focus();
          onChange(opt.value);
        };
      }
      list.append(item);
    });
  }

  if (currentOptions.length > 6) {
    const searchWrap = el('div', 'custom-select-search-wrap');
    const searchInput = el('input', 'custom-select-search');
    searchInput.placeholder = searchPlaceholder || 'Tìm kiếm...';
    searchInput.onclick = e => e.stopPropagation();
    searchInput.oninput = () => renderList(searchInput.value);
    searchWrap.append(searchInput);
    menu.append(searchWrap);
  }

  menu.append(list);
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
      return;
    }
    const items = Array.from(list.querySelectorAll('.custom-select-item:not(.is-disabled)'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && index >= 0) {
      e.preventDefault();
      items[index].click();
    }
  });
  updateButtonDisplay();
  renderList();

  btn.onclick = e => {
    e.stopPropagation();
    const open = menu.hidden;
    closeAllCustomSelects();
    if (open) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const rect = btn.getBoundingClientRect();
      const scrollParent = btn.closest('.fields') || btn.closest('.lookup-body') || btn.closest('.column-form');
      const limitBottom = scrollParent ? scrollParent.getBoundingClientRect().bottom : window.innerHeight;
      const spaceBelow = limitBottom - rect.bottom;
      if (spaceBelow < 160 && rect.top > 160) {
        menu.classList.add('drop-up');
      } else {
        menu.classList.remove('drop-up');
      }
      const search = menu.querySelector('.custom-select-search');
      if (search) {
        search.value = '';
        renderList('');
        setTimeout(() => search.focus(), 20);
      }
    }
  };

  btn.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (menu.hidden) btn.click();
    } else if (e.key === 'Escape') {
      if (!menu.hidden) {
        e.preventDefault();
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    }
  };

  wrap.append(btn, menu);
  wrap.setValue = val => {
    currentVal = val;
    updateButtonDisplay();
    renderList();
  };
  wrap.setOptions = newOpts => {
    currentOptions = [...newOpts];
    updateButtonDisplay();
    renderList();
  };
  wrap.btn = btn;
  wrap.menu = menu;
  return wrap;
}

// Keep the original selects as the form's source of truth while presenting the
// same searchable menu used by the rest of the application.
function enhanceSelect(select) {
  if (select.dataset.enhancedSelect || select.multiple || select.hidden || select.classList.contains('cell-input'))
    return;
  select.dataset.enhancedSelect = 'true';
  const label = select.closest('label');
  const title = select.getAttribute('aria-label') || label?.childNodes[0]?.textContent.trim() || 'Lựa chọn';
  const options = () =>
    Array.from(select.options, option => ({
      value: option.value,
      label: option.textContent,
      disabled: option.disabled,
      group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
    }));
  const custom = createCustomSelect({
    options: options(),
    value: select.value,
    ariaLabel: title,
    className: 'form-field-select column-custom-select',
    onChange(value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
  select.classList.add('column-native-select');
  select.tabIndex = -1;
  select.insertAdjacentElement('afterend', custom);
  const sync = () => {
    custom.setOptions(options());
    custom.setValue(select.value);
    custom.btn.disabled = select.disabled;
  };
  select.addEventListener('change', sync);
  custom.btn.addEventListener('click', sync, true);
  select.addEventListener('invalid', () => custom.btn.focus());
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
  select._syncColumnSelect = sync;
  sync();
}
function enhanceSelects(root) {
  if (root.matches?.('select')) enhanceSelect(root);
  root.querySelectorAll?.('select').forEach(enhanceSelect);
}

function getColumnSelectOptions(cols, rules, currentIndex) {
  return cols.map(c => {
    let pill = typeIcon(c),
      pillType = 't';
    if (state.table?.primary_keys?.includes(c.name)) {
      pill = '🔑';
      pillType = 'key';
    } else if (c.data_type === 'boolean') {
      pillType = 'bool';
    } else if (/int|numeric|decimal|real|double/.test(c.data_type)) {
      pillType = 'num';
    } else if (/date|time/.test(c.data_type)) {
      pillType = 'date';
    } else if (c.data_type === 'jsonb' || c.data_type === 'json') {
      pillType = 'json';
    }
    const isUsed = rules && rules.some((r, i) => i !== currentIndex && r.column === c.name);
    return { value: c.name, label: c.name, sub: c.data_type, pill, pillType, disabled: isUsed };
  });
}

function renderViewMenu(kind) {
  if (kind === 'filter') {
    const rules = state.view.filters || [],
      container = $('#filterRules'),
      countEl = $('#filterCount'),
      btn = $('#filterButton');
    container.replaceChildren();
    if (rules.length) {
      countEl.textContent = String(rules.length);
      btn.classList.add('has-active-rules');
    } else {
      countEl.textContent = '';
      btn.classList.remove('has-active-rules');
    }
    const clearBtn = $('#clearFilters');
    if (clearBtn) clearBtn.hidden = !rules.length;
    const cols = state.table.columns;
    if (!rules.length) {
      container.append(el('div', 'view-rules-empty', 'Chưa có điều kiện lọc nào'));
      return;
    }
    rules.forEach((rule, index) => {
      const row = el('div', 'view-rule filter-rule-row');
      const colOptions = getColumnSelectOptions(cols);
      const colDropdown = createCustomSelect({
        options: colOptions,
        value: rule.column,
        className: 'col-select',
        ariaLabel: `Cột lọc ${index + 1}`,
        searchPlaceholder: 'Tìm cột...',
        onChange(newCol) {
          rule.column = newCol;
          rule.value = '';
          applyRules('filter');
        },
      });
      const col = cols.find(c => c.name === rule.column) || cols[0];
      const isText = ['text', 'character varying', 'varchar', 'character'].includes(col.data_type);
      const isNum = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(col.data_type);
      const isDate = /date|time/.test(col.data_type);
      const isBool = col.data_type === 'boolean';
      const ops = [];
      if (isText)
        ops.push(
          { value: 'contains', label: 'chứa' },
          { value: 'equals', label: 'bằng' },
          { value: 'neq', label: 'khác' },
          { value: 'startswith', label: 'bắt đầu với' },
          { value: 'empty', label: 'để trống' },
          { value: 'not_empty', label: 'có dữ liệu' },
        );
      else if (isNum || isDate)
        ops.push(
          { value: 'equals', label: '=' },
          { value: 'neq', label: '≠' },
          { value: 'gt', label: '>' },
          { value: 'gte', label: '≥' },
          { value: 'lt', label: '<' },
          { value: 'lte', label: '≤' },
          { value: 'empty', label: 'để trống' },
          { value: 'not_empty', label: 'có dữ liệu' },
        );
      else if (isBool) ops.push({ value: 'equals', label: 'bằng' }, { value: 'empty', label: 'để trống' });
      else
        ops.push(
          { value: 'equals', label: 'bằng' },
          { value: 'neq', label: 'khác' },
          { value: 'empty', label: 'để trống' },
          { value: 'not_empty', label: 'có dữ liệu' },
        );
      if (!ops.some(o => o.value === rule.operator)) rule.operator = ops[0].value;
      const opDropdown = createCustomSelect({
        options: ops,
        value: rule.operator,
        className: 'op-select',
        ariaLabel: `Toán tử lọc ${index + 1}`,
        onChange(newOp) {
          rule.operator = newOp;
          applyRules('filter');
        },
      });
      let valInput;
      if (isBool) {
        const boolOps = [
          { value: 'true', label: 'true', pill: 'T', pillType: 'bool' },
          { value: 'false', label: 'false', pill: 'F', pillType: 'num' },
        ];
        valInput = createCustomSelect({
          options: boolOps,
          value: rule.value === 'false' ? 'false' : 'true',
          className: 'val-select',
          ariaLabel: `Giá trị lọc ${index + 1}`,
          onChange(newVal) {
            rule.value = newVal;
            applyRules('filter');
          },
        });
      } else if (col.enum_values?.length) {
        const enumOps = col.enum_values.map(val => ({ value: val, label: val }));
        valInput = createCustomSelect({
          options: enumOps,
          value: rule.value || col.enum_values[0] || '',
          className: 'val-select',
          ariaLabel: `Giá trị lọc ${index + 1}`,
          onChange(newVal) {
            rule.value = newVal;
            applyRules('filter');
          },
        });
      } else {
        valInput = el('input', 'rule-input');
        valInput.type = isNum ? 'number' : isDate ? 'date' : 'text';
        if (isNum) valInput.step = 'any';
        valInput.placeholder = 'Giá trị...';
        valInput.value = rule.value || '';
        let timer;
        valInput.oninput = () => {
          rule.value = valInput.value;
          clearTimeout(timer);
          timer = setTimeout(() => applyRules('filter'), 350);
        };
      }
      if (rule.operator === 'empty' || rule.operator === 'not_empty') {
        valInput.style.display = 'none';
      }
      const removeBtn = el('button', 'view-rule-button remove-btn', '×');
      removeBtn.type = 'button';
      removeBtn.title = 'Xóa điều kiện này';
      removeBtn.onclick = () => {
        rules.splice(index, 1);
        applyRules('filter');
      };
      row.append(colDropdown, opDropdown, valInput, removeBtn);
      container.append(row);
    });
    return;
  }
  const isGroup = kind === 'group',
    rules = isGroup ? state.view.groups : state.view.sorts,
    container = $('#' + kind + 'Rules'),
    countEl = $('#' + kind + 'Count'),
    btn = $('#' + kind + 'Button');
  container.replaceChildren();
  if (rules.length) {
    countEl.textContent = String(rules.length);
    btn.classList.add('has-active-rules');
  } else {
    countEl.textContent = '';
    btn.classList.remove('has-active-rules');
  }
  const available = state.table.columns.filter(
    c => !/json|array|bytea/i.test(c.data_type) && !c.data_type.startsWith('_'),
  );
  if (!rules.length) {
    container.append(el('div', 'view-rules-empty', isGroup ? 'Chưa có cột nhóm nào' : 'Chưa có thứ tự sắp xếp nào'));
  }
  rules.forEach((rule, index) => {
    const row = el('div', 'view-rule');
    const colOptions = getColumnSelectOptions(available, rules, index);
    const colDropdown = createCustomSelect({
      options: colOptions,
      value: rule.column,
      className: 'col-select',
      ariaLabel: `${isGroup ? 'Nhóm' : 'Sắp xếp'} ${index + 1}`,
      searchPlaceholder: 'Tìm cột...',
      onChange(newCol) {
        rule.column = newCol;
        applyRules(kind);
      },
    });
    const direction = el(
      'button',
      'view-rule-button dir-btn',
      rule.direction === 'asc' ? (isGroup ? 'A→Z' : '↑ Tăng') : isGroup ? 'Z→A' : '↓ Giảm',
    );
    direction.type = 'button';
    direction.title = 'Đổi chiều sắp xếp';
    direction.setAttribute('aria-label', `Đổi chiều ${rule.column}`);
    direction.onclick = () => {
      rule.direction = rule.direction === 'asc' ? 'desc' : 'asc';
      applyRules(kind);
    };
    const up = el('button', 'view-rule-button', '‹'),
      down = el('button', 'view-rule-button', '›'),
      remove = el('button', 'view-rule-button remove-btn', '×');
    for (const b of [up, down, remove]) b.type = 'button';
    up.setAttribute('aria-label', `Chuyển ${rule.column} lên`);
    down.setAttribute('aria-label', `Chuyển ${rule.column} xuống`);
    remove.setAttribute('aria-label', `Bỏ ${rule.column}`);
    up.disabled = index === 0;
    down.disabled = index === rules.length - 1;
    up.onclick = () => {
      [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
      applyRules(kind);
    };
    down.onclick = () => {
      [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
      applyRules(kind);
    };
    remove.onclick = () => {
      rules.splice(index, 1);
      applyRules(kind);
    };
    row.append(colDropdown, direction, up, down, remove);
    container.append(row);
  });
  $('#add' + (isGroup ? 'Group' : 'Sort')).disabled = available.every(c => rules.some(r => r.column === c.name));
}

function applyRules(kind) {
  state.page = 0;
  state.collapsed.clear();
  persistView();
  renderViewMenu(kind);
  const m = $('#' + kind + 'Menu'),
    b = $('#' + kind + 'Button');
  if (m && b) {
    m.hidden = false;
    b.setAttribute('aria-expanded', 'true');
  }
  void load({ silent: true });
}

const clearFiltersBtn = $('#clearFilters');
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
function typeIcon(c) {
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
