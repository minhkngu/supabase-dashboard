// Global shortcuts: "/" focuses the table search and Ctrl/⌘+K opens a
// searchable table switcher.
import { choose } from './grid/render.js';
import { $, el, name, state } from './state.js';

const normalize = value =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

let matches = [],
  active = 0;

function isTyping(target) {
  return !!target.closest?.('input,textarea,select,[contenteditable=true]');
}

function drawResults() {
  const term = normalize($('#quickSwitchInput').value.trim());
  matches = state.tables.filter(t => !term || normalize(name(t)).includes(term));
  active = Math.min(active, Math.max(0, matches.length - 1));
  const list = $('#quickSwitchList');
  list.replaceChildren(
    ...matches.map((table, index) => {
      const option = el('li', 'quick-switch-option', name(table));
      option.id = `quickSwitchOption${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === active));
      if (table === state.table) option.append(el('span', 'quick-switch-current', 'Đang mở'));
      option.onclick = () => pick(index);
      return option;
    }),
  );
  if (!matches.length) list.append(el('li', 'quick-switch-empty', 'Không có bảng phù hợp'));
  $('#quickSwitchInput').setAttribute('aria-activedescendant', matches.length ? `quickSwitchOption${active}` : '');
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function pick(index) {
  const table = matches[index];
  if (!table) return;
  $('#quickSwitch').close();
  if (table !== state.table) choose(table);
}

export function openQuickSwitch() {
  if (!state.tables.length) return;
  const dialog = $('#quickSwitch');
  if (dialog.open) return;
  $('#quickSwitchInput').value = '';
  active = 0;
  drawResults();
  dialog.showModal();
  $('#quickSwitchInput').focus();
}

export function initQuickSwitch() {
  document.addEventListener('keydown', event => {
    const target = /** @type {HTMLElement} */ (event.target);
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openQuickSwitch();
      return;
    }
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(target)) {
      if (document.querySelector('dialog[open]') || state.cellEdit || $('#search').closest('[hidden]')) return;
      event.preventDefault();
      $('#search').focus();
      $('#search').select();
    }
  });
  $('#quickSwitchInput').addEventListener('input', () => {
    active = 0;
    drawResults();
  });
  $('#quickSwitchInput').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!matches.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      drawResults();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(active);
    }
  });
}
