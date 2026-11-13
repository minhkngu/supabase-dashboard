import { patchView } from './grid-state.js';
// Menu opened from a column header: sort, filter, group, hide, pin and
// column settings without going through the toolbar menus.
import { openColumnDialog } from '../column-dialog.js';
import { showLookupDialog } from '../lookup.js';
import { el, state } from '../state.js';
import { applyRules, closeViewMenus, persistView } from '../view-menus.js';
import { render } from './render.js';

let openMenu = null;

export function closeColumnMenu({ restoreFocus = false } = {}) {
  if (!openMenu) return;
  const { menu, anchor } = openMenu;
  openMenu = null;
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor.isConnected) anchor.focus();
}

function sortable(column) {
  return column && !/json|array|bytea/i.test(column.data_type) && !column.data_type.startsWith('_');
}

function menuItems(spec) {
  const column = spec.column,
    label = column ? column.name : spec.lookup.label,
    pinned = state.view.frozen.includes(spec.id),
    items = [];
  if (sortable(column)) {
    for (const [direction, text] of [
      ['asc', 'Sắp xếp tăng dần'],
      ['desc', 'Sắp xếp giảm dần'],
    ])
      items.push({
        text,
        run() {
          patchView({ sorts: [{ column: column.name, direction }] });
          applyRules('sort', { open: false });
        },
      });
  }
  if (column) {
    items.push({
      text: 'Lọc theo cột này',
      run() {
        patchView({
          filters: [...(state.view.filters || []), { column: column.name, operator: 'contains', value: '' }],
        });
        applyRules('filter');
        setTimeout(() => {
          const inputs = document.querySelectorAll('#filterMenu input:not([type="checkbox"])');
          /** @type {HTMLElement} */ (inputs[inputs.length - 1])?.focus();
        }, 0);
      },
    });
  }
  if (sortable(column)) {
    items.push({
      text: 'Nhóm theo cột này',
      run() {
        patchView({ groups: [{ column: column.name, direction: 'asc' }] });
        applyRules('group', { open: false });
      },
    });
  }
  items.push(
    {
      text: 'Ẩn cột',
      run() {
        if (!state.view.hidden.includes(spec.id)) patchView({ hidden: [...state.view.hidden, spec.id] });
        persistView();
        render();
      },
    },
    {
      text: pinned ? 'Bỏ ghim cột' : 'Ghim cột',
      run() {
        patchView({
          frozen: pinned ? state.view.frozen.filter(id => id !== spec.id) : [...state.view.frozen, spec.id],
        });
        persistView();
        render();
      },
    },
    {
      text: 'Thiết lập cột',
      run() {
        if (spec.lookup) showLookupDialog();
        else openColumnDialog(spec);
      },
    },
  );
  return { label, items };
}

export function openColumnMenu(spec, anchor) {
  const { label, items } = menuItems(spec);
  openPopupMenu(anchor, `Tùy chọn cột ${label}`, items);
}

// A small keyboard-navigable menu anchored below a button or header.
export function openPopupMenu(anchor, ariaLabel, items) {
  const reopen = openMenu?.anchor === anchor;
  closeColumnMenu();
  if (reopen) return;
  closeViewMenus();
  const menu = el('div', 'column-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', ariaLabel);
  for (const item of items) {
    const button = el('button', 'column-menu-item' + (item.danger ? ' is-danger' : ''), item.text);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.onclick = () => {
      closeColumnMenu();
      item.run();
    };
    menu.append(button);
  }
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button')],
      index = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (event.key === 'Escape') {
      event.preventDefault();
      closeColumnMenu({ restoreFocus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].focus();
    } else if (event.key === 'Tab') closeColumnMenu();
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect(),
    width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { menu, anchor };
  /** @type {HTMLElement} */ (menu.firstElementChild)?.focus();
}

export function initColumnMenu() {
  document.addEventListener(
    'pointerdown',
    event => {
      if (!openMenu) return;
      const target = /** @type {Node} */ (event.target);
      if (!openMenu.menu.contains(target) && !openMenu.anchor.contains(target)) closeColumnMenu();
    },
    true,
  );
  addEventListener('resize', () => closeColumnMenu());
  document.addEventListener('scroll', () => closeColumnMenu(), true);
}
