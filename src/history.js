import { api, toast } from './api.js';
import { load } from './grid/render.js';
import { $, deletionBusy, name, state } from './state.js';

export function historyFor(table) {
  const id = name(table);
  if (!state.history.has(id)) state.history.set(id, { undo: [], redo: [] });
  return state.history.get(id);
}
export function updateHistoryButtons() {
  const history = state.table && historyFor(state.table);
  $('#undoCell').disabled = !state.configReady || !history?.undo.length || state.historyBusy || deletionBusy;
  $('#redoCell').disabled = !state.configReady || !history?.redo.length || state.historyBusy || deletionBusy;
}
export async function commitCell(table, row, column, value) {
  const key = Object.fromEntries(table.primary_keys.map(k => [k, row[k]])),
    old = row[column.name] ?? null;
  const result = await api(`/api/table/${name(table)}`, {
    method: 'PATCH',
    body: JSON.stringify({ key, values: { [column.name]: value }, expected: { [column.name]: old } }),
  });
  const saved = result.rows?.[0];
  if (!saved) throw Error('Không tìm thấy bản ghi đã lưu.');
  const history = historyFor(table);
  history.undo.push({
    column: column.name,
    before: old,
    after: saved[column.name],
    beforeKey: key,
    afterKey: Object.fromEntries(table.primary_keys.map(k => [k, saved[k]])),
  });
  if (history.undo.length > 50) history.undo.shift();
  history.redo = [];
  updateHistoryButtons();
  return saved;
}
// Undo a specific saved change, but only while it is still the latest one.
export function undoLatest(table, entry) {
  if (historyFor(table).undo.at(-1) !== entry || state.table !== table) {
    toast('Không thể hoàn tác vì đã có thay đổi khác sau đó.');
    return;
  }
  void changeHistory('undo');
}
export async function changeHistory(direction) {
  if (deletionBusy || !state.configReady || !state.table || state.historyBusy || state.cellEdit) return;
  const table = state.table,
    history = historyFor(table),
    from = history[direction],
    item = from.at(-1);
  if (!item) return;
  state.historyBusy = true;
  updateHistoryButtons();
  try {
    const undo = direction === 'undo',
      key = undo ? item.afterKey : item.beforeKey,
      value = undo ? item.before : item.after,
      expected = undo ? item.after : item.before;
    await api(`/api/table/${name(table)}`, {
      method: 'PATCH',
      body: JSON.stringify({ key, values: { [item.column]: value }, expected: { [item.column]: expected } }),
    });
    from.pop();
    history[undo ? 'redo' : 'undo'].push(item);
    if (state.table === table) await load({ silent: true });
    toast(undo ? 'Đã hoàn tác' : 'Đã làm lại');
  } catch (error) {
    toast(error.message);
  } finally {
    state.historyBusy = false;
    updateHistoryButtons();
  }
}
export function initHistory() {
  $('#undoCell').onclick = () => changeHistory('undo');
  $('#redoCell').onclick = () => changeHistory('redo');
  document.addEventListener('keydown', e => {
    if (
      !(e.metaKey || e.ctrlKey) ||
      e.altKey ||
      e.key.toLowerCase() !== 'z' ||
      /** @type {HTMLElement} */ (e.target).closest('input,textarea,select,[contenteditable=true]') ||
      document.querySelector('dialog[open]')
    )
      return;
    e.preventDefault();
    changeHistory(e.shiftKey ? 'redo' : 'undo');
  });
}
