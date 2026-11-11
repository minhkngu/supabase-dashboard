import { el } from './state.js';
import { closeAllCustomSelects } from './view-menus.js';

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
export function initCustomSelect() {
  enhanceSelects(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) enhanceSelects(node);
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', closeAllCustomSelects));
}
