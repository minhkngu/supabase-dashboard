import { toast } from './api.js';
import { createCustomSelect } from './custom-select.js';
import { load, render } from './grid/render.js';
import { clearBulk } from './grid/selection.js';
import { activeLookups } from './lookup.js';
import { typeIcon } from './record-editor.js';
import { $, el, name, state, $$ } from './state.js';

const viewStorageKey = 'siris-views-v1';
export function restoreViews() {
  try {
    const data = JSON.parse(localStorage.getItem(viewStorageKey) || '{}');
    state.views = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    state.views = {};
  }
}
export function validFilterRules(rules, table) {
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
export function validRules(rules, table) {
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
export function displayedColumns(includeHidden = false) {
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
export function setVisibleOrder(ids) {
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
        $$('.column-reorder-handle', list)
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
export function initViewMenus() {
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
}

const showAllBtn = $('#showAllColumns');
const colSearch = $('#columnSearchInput');
export function closeAllCustomSelects() {
  $$('.custom-select-menu:not([hidden])').forEach(m => {
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

export function renderViewMenu(kind) {
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

// open: false applies the rules without showing the toolbar menu.
export function applyRules(kind, { open = true } = {}) {
  state.page = 0;
  state.collapsed.clear();
  persistView();
  renderViewMenu(kind);
  const m = $('#' + kind + 'Menu'),
    b = $('#' + kind + 'Button');
  if (open && m && b) {
    m.hidden = false;
    b.setAttribute('aria-expanded', 'true');
  }
  void load({ silent: true });
}
export function initViewMenus2() {
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
    const target = /** @type {HTMLElement} */ (e.target);
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
      target.closest?.('.view-menu') ||
      target.closest?.('.custom-select-menu');

    if (!inside) {
      closeViewMenus();
    } else if (!target.closest?.('.custom-select-wrap')) {
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
}

const clearFiltersBtn = $('#clearFilters');
