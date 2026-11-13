// Dữ liệu và phân trang của lưới được thay đổi qua module này.
const grid = { rows: [], page: 0, total: 0, view: null };
export const getRows = () => grid.rows;
export const getPage = () => grid.page;
export const getTotal = () => grid.total;
export const getView = () => grid.view;
export function setRows(rows) {
  grid.rows = rows;
}
export function setPage(page) {
  grid.page = page;
}
export function setView(view) {
  grid.view = view;
}
export function setTotal(total) {
  grid.total = total;
}

// Các thao tác trên view giữ nguyên tham chiếu để callback đang mở vẫn hợp lệ.
export function patchView(values) {
  Object.assign(grid.view, values);
}
export function patchRule(kind, index, values) {
  Object.assign(grid.view[kind][index], values);
}
export function addRule(kind, rule) {
  (grid.view[kind] ||= []).push(rule);
}
export function removeRule(kind, index) {
  grid.view[kind].splice(index, 1);
}
export function moveRule(kind, index, to) {
  const rules = grid.view[kind];
  [rules[index], rules[to]] = [rules[to], rules[index]];
}
export function insertDuplicateColumn(original, copy) {
  const order = grid.view.order;
  const index = order.indexOf(copy);
  if (index >= 0) order.splice(index, 1);
  order.splice(Math.max(0, order.indexOf(original) + 1), 0, copy);
}
export function renameViewColumn(oldName, newName) {
  const view = grid.view;
  if (!view) return;
  for (const rules of [view.filters, view.groups, view.sorts])
    for (const rule of rules || []) if (rule.column === oldName) rule.column = newName;
  for (const list of [view.order, view.frozen, view.hidden])
    for (let i = 0; i < (list || []).length; i++) if (list[i] === 'col:' + oldName) list[i] = 'col:' + newName;
  if (view.widths && Object.hasOwn(view.widths, 'col:' + oldName)) {
    view.widths['col:' + newName] = view.widths['col:' + oldName];
    delete view.widths['col:' + oldName];
  }
}

export function patchRow(row, values) {
  return Object.assign(row, values);
}
export function setRowValue(row, column, value) {
  row[column] = value;
}

let views = {};
export const getViews = () => views;
export function setViews(value) {
  views = value;
}
export function saveCurrentView(table) {
  views[table] = grid.view;
}
export function prepareSavedView(table, hasName) {
  const saved = views[table] || {};
  if (!saved.freezeDefaultInitialized && hasName && (!Array.isArray(saved.frozen) || saved.frozen.length === 0))
    saved.frozen = ['col:name'];
  saved.freezeDefaultInitialized = true;
  return saved;
}
