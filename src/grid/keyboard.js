// Spreadsheet-style keyboard use of the grid: arrow keys move between cells,
// typing starts editing, and focus survives the re-render after a save.
import { $, $$, state } from '../state.js';

/** @type {{ row: string, column: string, activate?: boolean } | null} */
let pendingFocus = null;

function cellAt(row, column) {
  return $$('#grid td[data-bulk-column]').find(
    cell => cell.dataset.bulkRow === row && cell.dataset.bulkColumn === column,
  );
}

function position(td) {
  return { row: td.dataset.bulkRow, column: td.dataset.bulkColumn };
}

// The cell next to td in the given direction, skipping group header rows.
export function neighbourCell(td, rowStep, columnStep) {
  if (columnStep) {
    const cells = $$('td[data-bulk-column]', td.parentElement),
      index = cells.indexOf(td);
    return cells[index + columnStep] || null;
  }
  const rows = $$('#grid tbody tr').filter(row => row.querySelector('td[data-bulk-column]')),
    index = rows.indexOf(td.parentElement);
  for (let i = index + rowStep; i >= 0 && i < rows.length; i += rowStep) {
    const cell = $$('td[data-bulk-column]', rows[i]).find(item => item.dataset.bulkColumn === td.dataset.bulkColumn);
    if (cell) return cell;
  }
  return null;
}

// Remembers which cell should take focus (and optionally open) after the grid
// is rebuilt; render() calls restoreCellFocus() once the new cells exist.
export function queueCellFocus(td, { activate = false } = {}) {
  pendingFocus = td ? { ...position(td), activate } : null;
}

export function clearCellFocus() {
  pendingFocus = null;
}

export function restoreCellFocus() {
  if (!pendingFocus || state.cellEdit) return;
  const target = pendingFocus;
  pendingFocus = null;
  const cell = cellAt(target.row, target.column);
  if (!cell) return;
  cell.focus();
  if (target.activate) cell.click();
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function initKeyboard() {
  $('#grid').addEventListener('keydown', event => {
    const td = /** @type {HTMLElement} */ (event.target);
    if (!td.matches?.('td[data-bulk-column]') || state.cellEdit) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const arrow = ARROWS[event.key];
    if (arrow && !event.shiftKey) {
      event.preventDefault();
      neighbourCell(td, arrow[0], arrow[1])?.focus();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      td.click();
      return;
    }
    if (event.key.length !== 1 || event.key === ' ' || !td.classList.contains('cell-editable')) return;
    // Typing on a cell replaces its value, as in a spreadsheet.
    event.preventDefault();
    td.click();
    const input = state.cellEdit?.td === td ? state.cellEdit.input : null;
    if (input && input.tagName === 'INPUT' && input.type === 'text') {
      input.value = event.key;
      input.dispatchEvent(new Event('input'));
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
