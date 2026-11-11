import { toast } from '../api.js';
import { createCustomSelect } from '../custom-select.js';
import { commitCell } from '../history.js';
import { activeLookups, configValid, loadLookups, lookupTable, openLinkPicker } from '../lookup.js';
import { openEditor, valueFor } from '../record-editor.js';
import { nativeRelations, relationDisplayField } from '../relation-display.js';
import { el, name, pendingRows, state, writable, $$ } from '../state.js';
import { clearCellFocus, neighbourCell, queueCellFocus } from './keyboard.js';
import { load, render } from './render.js';

export function initCellEdit() {
  document.addEventListener(
    'pointerdown',
    e => {
      const edit = state.cellEdit;
      if (edit && !edit.td.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        if (edit.saving) return;
        // Saving re-renders the grid, so remember the clicked cell and open it
        // afterwards instead of swallowing the click.
        const target = /** @type {HTMLElement} */ (e.target).closest?.('#grid td[data-bulk-column]');
        const plain = !(e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) && e.button === 0;
        queueCellFocus(target && plain ? target : null, { activate: true });
        edit.input.blur();
      }
    },
    true,
  );
}

export function formatNumber(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return s;
  if (/[eE]/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
  }
  const sign = s.startsWith('-') ? '-' : s.startsWith('+') ? '+' : '';
  const raw = sign ? s.slice(1) : s;
  const parts = raw.split('.');
  const intPart = parts[0] || '0';
  const decPart = parts[1];
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + formattedInt + (decPart !== undefined ? '.' + decPart : '');
}
export function formatNumberInput(input) {
  const raw = input.value;
  if (!raw || !/^([+-]?)(?:\d*(?:\.\d*)?)$/.test(raw)) return;
  const caret = input.selectionStart ?? raw.length,
    logicalCaret = raw.slice(0, caret).replace(/,/g, '').length;
  const formatted = formatNumber(raw);
  if (formatted === raw) return;
  input.value = formatted;
  let seen = 0,
    next = 0;
  while (next < formatted.length && seen < logicalCaret) {
    if (formatted[next] !== ',') seen++;
    next++;
  }
  input.setSelectionRange(next, next);
}

export function editableCell(td, row, c) {
  const table = state.table;
  const canEdit =
    writable(c) &&
    table.primary_keys?.length &&
    !table.primary_keys.includes(c.name) &&
    table.primary_keys.every(k => row[k] != null);
  const isNum = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type);
  const longContent =
    /json/.test(c.data_type) ||
    c.data_type.startsWith('_') ||
    (typeof row[c.name] === 'string' && (row[c.name].length > 120 || row[c.name].includes('\n')));
  td.tabIndex = 0;
  td.setAttribute(
    'aria-label',
    `${c.name}: ${row[c.name] == null ? 'null' : typeof row[c.name] === 'object' ? JSON.stringify(row[c.name]) : isNum ? formatNumber(row[c.name]) : row[c.name]}${canEdit ? ', nhấn Enter để sửa' : ', chỉ đọc'}`,
  );
  td.classList.add(canEdit ? 'cell-editable' : 'cell-readonly');
  const activate = () => {
    if (!canEdit) return;
    if (pendingRows.has(row)) {
      toast('Bản ghi đang được lưu.');
      return;
    }
    const links = activeLookups().filter(x => x.sourceColumn === c.name && configValid(x));
    for (const native of nativeRelations(table).filter(x => x.config.sourceColumn === c.name)) {
      const target = lookupTable(native.config.targetTable);
      if (
        target &&
        !links.some(x => x.targetTable === native.config.targetTable && x.targetKey === native.config.targetKey)
      )
        links.push({
          id: native.id,
          label: native.label,
          sourceColumn: c.name,
          targetTable: native.config.targetTable,
          targetKey: native.config.targetKey,
          targetField: relationDisplayField(native),
        });
    }
    if (links.length) {
      openLinkPicker(row, c, table, links);
      return;
    }
    if (longContent) {
      openEditor(row);
      return;
    }
    startCellEdit(td, row, c, table);
  };
  td.onclick = e => {
    e.stopPropagation();
    activate();
  };
  td.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      activate();
    }
  };
}
// Formulas and synced lookups are recomputed by database triggers, so other
// cells of the saved row may change; only then is a reload worth it.
function writeAffectsOtherCells(table) {
  const tableName = name(table);
  return (
    (state.formulas || []).some(f => f.enabled && f.table === tableName) ||
    (state.lookups || []).some(x => x.sourceTable === tableName && x.sync?.enabled)
  );
}
function startCellEdit(td, row, c, table) {
  if (state.cellEdit || !td.isConnected) return;
  const original = row[c.name];
  const input = el(c.data_type === 'boolean' || c.enum_values?.length ? 'select' : 'input', 'cell-input');
  if (c.enum_values?.length) {
    if (c.options.includes('nullable')) input.append(new Option('[null]', ''));
    for (const option of c.enum_values) input.append(new Option(option, option));
    input.value = original == null ? '' : String(original);
  } else if (c.data_type === 'boolean') {
    if (c.options.includes('nullable')) input.append(new Option('[null]', ''));
    input.append(new Option('true', 'true'), new Option('false', 'false'));
    input.value = original == null ? '' : String(original);
  } else {
    const numeric = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type);
    input.type = c.data_type === 'date' ? 'date' : 'text';
    if (numeric) {
      input.inputMode = 'decimal';
      input.value = original == null ? '' : formatNumber(original);
      input.oninput = () => formatNumberInput(input);
    } else input.value = original == null ? '' : String(original);
  }
  input.setAttribute('aria-label', `Sửa ${c.name}`);
  td.replaceChildren(input);
  td.classList.add('editing');
  const edit = { td, input, table, saving: false, cancelled: false };
  state.cellEdit = edit;
  if (input.tagName !== 'SELECT') {
    input.focus();
    if (input.select && input.type === 'text') input.select();
  }
  function cleanup() {
    edit.menu?.remove();
    if (edit.outside) document.removeEventListener('pointerdown', edit.outside, true);
  }
  function cancel() {
    if (edit.saving) return;
    edit.cancelled = true;
    cleanup();
    state.cellEdit = null;
    render();
  }
  async function save() {
    if (edit.cancelled || edit.saving || state.cellEdit !== edit) return;
    let value;
    try {
      if (input.validity?.badInput) throw Error(`Giá trị ${c.name} không hợp lệ.`);
      value = valueFor(c, input.value);
      if (value === null && !c.options.includes('nullable')) throw Error(`Cột ${c.name} không được để trống.`);
    } catch (error) {
      td.classList.add('cell-error');
      clearCellFocus();
      toast(error.message);
      input.focus();
      return;
    }
    if (value === original || (value !== null && original !== null && String(value) === String(original))) {
      cleanup();
      state.cellEdit = null;
      render();
      return;
    }
    cleanup();
    edit.saving = true;
    const request = commitCell(table, row, c, value);
    pendingRows.add(row);
    row[c.name] = value;
    state.cellEdit = null;
    if (state.table === table) render();
    try {
      const saved = await request;
      Object.assign(row, saved);
      pendingRows.delete(row);
      if (state.table === table && !state.cellEdit) {
        render();
        if (writeAffectsOtherCells(table)) void load({ silent: true });
        else loadLookups();
      }
      toast('Đã lưu thay đổi');
    } catch (error) {
      row[c.name] = original;
      pendingRows.delete(row);
      toast(error.message);
      if (state.table === table && !state.cellEdit) {
        render();
        const index = state.rows.indexOf(row),
          cell = $$('#grid td[data-bulk-column]').find(
            item => item.dataset.bulkRow === String(index) && item.dataset.bulkColumn === c.name,
          );
        if (cell) {
          startCellEdit(cell, row, c, table);
          if (state.cellEdit) {
            state.cellEdit.input.value = input.value;
            state.cellEdit.select?.setValue(input.value);
            state.cellEdit.td.classList.add('cell-error');
            (state.cellEdit.select?.btn || state.cellEdit.input).focus();
          }
        }
      }
    }
  }
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      queueCellFocus(td);
      cancel();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      // Enter moves down, Tab right and Shift+Tab left, as in a spreadsheet.
      const next = e.key === 'Enter' ? neighbourCell(td, 1, 0) : neighbourCell(td, 0, e.shiftKey ? -1 : 1);
      queueCellFocus(next || td);
      save();
    }
  };
  if (input.tagName === 'SELECT') {
    const custom = createCustomSelect({
      options: Array.from(input.options, o => ({ value: o.value, label: o.textContent })),
      value: input.value,
      ariaLabel: `Sửa ${c.name}`,
      className: 'form-field-select cell-select',
      onChange(value) {
        input.value = value;
        void save();
      },
    });
    edit.select = custom;
    edit.menu = custom.menu;
    input.hidden = true;
    td.append(custom);
    document.body.append(custom.menu);
    custom.menu.classList.add('cell-select-menu');
    const position = () => {
      const rect = custom.btn.getBoundingClientRect(),
        height = custom.menu.getBoundingClientRect().height;
      custom.menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.max(rect.width, 160) - 8))}px`;
      custom.menu.style.top = `${rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
      custom.menu.style.width = `${Math.max(rect.width, 160)}px`;
    };
    custom.btn.addEventListener('click', () => {
      if (!custom.menu.hidden) position();
    });
    custom.btn.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'ArrowDown' && !custom.menu.hidden) {
        e.preventDefault();
        custom.menu.querySelector('.custom-select-item:not(.is-disabled)')?.focus();
      }
    });
    custom.menu.addEventListener(
      'keydown',
      e => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      },
      true,
    );
    edit.outside = e => {
      if (!custom.contains(e.target) && !custom.menu.contains(e.target)) cancel();
    };
    document.addEventListener('pointerdown', edit.outside, true);
    custom.btn.focus();
    custom.btn.click();
  } else input.onblur = () => save();
}
