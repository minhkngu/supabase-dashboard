import { autoScrollWhileDragging } from '../dnd.js';
import { columnKind, icon } from '../icons.js';
import { openColumnMenu } from './column-menu.js';
import { openColumnDialog } from '../column-dialog.js';
import { showLookupDialog } from '../lookup.js';
import { nativeRelations, openRelationDisplay } from '../relation-display.js';
import { $, $$, el, state } from '../state.js';
import { displayedColumns, isUuidId, persistView, setVisibleOrder } from '../view-menus.js';

export function columnHeader(spec, render) {
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
  if (isUuidId(c)) th.classList.add('uuid-id');
  th.draggable = true;
  th.title = 'Bấm để mở tùy chọn cột, kéo để đổi vị trí';
  th.tabIndex = 0;
  th.setAttribute('aria-haspopup', 'menu');
  th.setAttribute('aria-expanded', 'false');
  th.onclick = () => openColumnMenu(spec, th);
  th.onkeydown = e => {
    if (e.target !== th || !['Enter', ' ', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    openColumnMenu(spec, th);
  };
  const label = el('span', 'column-label');
  const kind = x ? { icon: 'lookup', label: 'Lookup' } : columnKind(c, state.table),
    typeIconEl = el('span', 'type-icon');
  typeIconEl.title = kind.label;
  typeIconEl.append(icon(kind.icon, { size: 12 }));
  label.append(typeIconEl, document.createTextNode(x ? x.label : c.name));
  const pinned = state.view.frozen.includes(spec.id),
    pin = el('button', 'column-pin');
  pin.append(icon('pin', { size: 12, filled: pinned }));
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
  const edit = el('button', 'column-action');
  edit.append(icon('more', { size: 14 }));
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
  for (const button of th.querySelectorAll('button')) button.draggable = false;
  th.ondragstart = e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-siris-column', spec.id);
    draggedColumn = spec.id;
    th.classList.add('column-dragging');
  };
  th.ondragend = () => {
    draggedColumn = null;
    th.classList.remove('column-dragging');
    clearColumnDrop();
  };
  th.ondragover = e => {
    if (!draggedColumn) return;
    autoScrollWhileDragging(th.closest('.table-scroll'), e, 'x');
    const target = columnDropTarget(spec.id, th, e);
    if (!target) {
      // Crossing between pinned and unpinned columns is not allowed.
      e.dataTransfer.dropEffect = 'none';
      clearColumnDrop();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!th.classList.contains(`column-drop-${target.side}`)) {
      clearColumnDrop();
      th.classList.add(`column-drop-${target.side}`);
    }
  };
  th.ondragleave = e => {
    if (!th.contains(e.relatedTarget)) th.classList.remove('column-drop-before', 'column-drop-after');
  };
  th.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();
    const from = draggedColumn || e.dataTransfer.getData('application/x-siris-column'),
      target = columnDropTarget(spec.id, th, e);
    clearColumnDrop();
    if (!from || from === spec.id || !target) return;
    const all = displayedColumns().map(c => c.id);
    all.splice(all.indexOf(from), 1);
    let index = all.indexOf(spec.id);
    if (target.side === 'after') index++;
    all.splice(index, 0, from);
    setVisibleOrder(all);
    persistView();
    setTimeout(render, 0);
  };
  return th;
}
let draggedColumn = null;
function clearColumnDrop() {
  document
    .querySelectorAll('.column-drop-before,.column-drop-after')
    .forEach(n => n.classList.remove('column-drop-before', 'column-drop-after'));
}
// Where a dragged column would land relative to header th, or null when the
// move would cross the pinned boundary.
function columnDropTarget(toId, th, e) {
  const frozen = state.view.frozen;
  if (!draggedColumn || frozen.includes(draggedColumn) !== frozen.includes(toId)) return null;
  const rect = th.getBoundingClientRect();
  return { side: e.clientX > rect.left + rect.width / 2 ? 'after' : 'before' };
}
export function updateFrozen() {
  const grid = $('#grid');
  for (const cell of grid.querySelectorAll('.frozen-cell')) {
    cell.classList.remove('frozen-cell', 'frozen-number', 'frozen-edge');
    cell.style.left = '';
  }
  const heads = $$('thead th[data-column-id]', grid),
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
