import { removeRule } from './grid/grid-state.js';
// Active filters, groups and sorts shown as removable chips under the toolbar.
import { $, el, state } from './state.js';
import { applyRules } from './view-menus.js';

const OPERATORS = {
  contains: 'chứa',
  equals: '=',
  neq: '≠',
  startswith: 'bắt đầu với',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  empty: 'để trống',
  not_empty: 'có dữ liệu',
};

function chip(text, removeLabel, remove) {
  const item = el('span', 'rule-chip'),
    button = el('button', 'rule-chip-remove', '×');
  button.type = 'button';
  button.setAttribute('aria-label', removeLabel);
  button.onclick = remove;
  item.append(el('span', 'rule-chip-text', text), button);
  return item;
}

export function renderRuleChips() {
  const host = $('#ruleChips'),
    view = state.view;
  if (!host) return;
  const chips = [];
  if (view && !$('.toolbar').hidden) {
    (view.filters || []).forEach((rule, index) => {
      const value = ['empty', 'not_empty'].includes(rule.operator) ? '' : ` “${rule.value}”`;
      chips.push(
        chip(`${rule.column} ${OPERATORS[rule.operator] || rule.operator}${value}`, `Bỏ lọc ${rule.column}`, () => {
          removeRule('filters', index);
          applyRules('filter', { open: false });
        }),
      );
    });
    for (const [kind, prefix] of [
      ['groups', 'Nhóm'],
      ['sorts', 'Sắp xếp'],
    ])
      (view[kind] || []).forEach((rule, index) => {
        chips.push(
          chip(
            `${prefix}: ${rule.column} ${rule.direction === 'desc' ? '↓' : '↑'}`,
            `Bỏ ${prefix.toLowerCase()} theo ${rule.column}`,
            () => {
              removeRule(kind, index);
              applyRules(kind === 'groups' ? 'group' : 'sort', { open: false });
            },
          ),
        );
      });
  }
  host.replaceChildren(...chips);
  host.hidden = !chips.length;
}
