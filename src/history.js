import { historyForName, recordChange, transferChange, setHistoryBusy } from './history-state.js';
import { writeApi } from './write-api.js';
import { toast } from './api.js';
import { gridAction } from './events.js';
import { $, getDeletionBusy, name, state } from './state.js';

export function historyFor(table) {
  return historyForName(name(table));
}
export function updateHistoryButtons() {
  const history = state.table && historyFor(state.table);
  $('#undoCell').disabled = !state.configReady || !history?.undo.length || state.historyBusy || getDeletionBusy();
  $('#redoCell').disabled = !state.configReady || !history?.redo.length || state.historyBusy || getDeletionBusy();
}
// Điều kiện chống ghi đè: máy chủ so từng cột bằng `eq.` nên chỉ nhận giá trị đơn.
// Bỏ cột JSON, mảng và mọi giá trị object; trả undefined khi không còn cột nào.
export function expectedValues(table, values) {
  const result = {};
  for (const [column, value] of Object.entries(values)) {
    const type = String(table.columns?.find(c => c.name === column)?.data_type || '');
    if (/json|array/i.test(type) || type.startsWith('_')) continue;
    if (value !== null && typeof value === 'object') continue;
    result[column] = value;
  }
  return Object.keys(result).length ? result : undefined;
}
export async function commitCell(table, row, column, value) {
  const key = Object.fromEntries(table.primary_keys.map(k => [k, row[k]])),
    old = row[column.name] ?? null;
  const result = await writeApi(`/api/table/${name(table)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      key,
      values: { [column.name]: value },
      expected: expectedValues(table, { [column.name]: old }),
    }),
  });
  const saved = result.rows?.[0];
  if (!saved) throw Error('Không tìm thấy bản ghi đã lưu.');
  recordChange(name(table), {
    column: column.name,
    before: old,
    after: saved[column.name],
    beforeKey: key,
    afterKey: Object.fromEntries(table.primary_keys.map(k => [k, saved[k]])),
  });
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
  if (getDeletionBusy() || !state.configReady || !state.table || state.historyBusy || state.cellEdit) return;
  const table = state.table,
    history = historyFor(table),
    from = history[direction],
    item = from.at(-1);
  if (!item) return;
  setHistoryBusy(true);
  updateHistoryButtons();
  try {
    const undo = direction === 'undo',
      key = undo ? item.afterKey : item.beforeKey,
      value = undo ? item.before : item.after,
      expected = undo ? item.after : item.before;
    await writeApi(`/api/table/${name(table)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        key,
        values: { [item.column]: value },
        expected: expectedValues(table, { [item.column]: expected }),
      }),
    });
    transferChange(name(table), direction);
    if (state.table === table) await gridAction('load', { silent: true });
    toast(undo ? 'Đã hoàn tác' : 'Đã làm lại');
  } catch (error) {
    toast(error.message);
  } finally {
    setHistoryBusy(false);
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
