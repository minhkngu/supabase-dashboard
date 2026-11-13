import { recordIdentity } from '../record-deletion.mjs';

const entries = new Map();
let busy = false;
export const historyBusy = () => busy;
export function setHistoryBusy(value) {
  busy = value;
}
export function historyForName(id) {
  if (!entries.has(id)) entries.set(id, { undo: [], redo: [] });
  return entries.get(id);
}
export function recordChange(id, entry) {
  const history = historyForName(id);
  history.undo.push(entry);
  if (history.undo.length > 50) history.undo.shift();
  history.redo = [];
}
export function transferChange(id, direction) {
  const history = historyForName(id);
  history[direction === 'undo' ? 'redo' : 'undo'].push(history[direction].pop());
}
export function forgetRecord(id, table, identity) {
  const history = entries.get(id);
  if (!history) return;
  for (const direction of ['undo', 'redo'])
    history[direction] = history[direction].filter(
      item => recordIdentity(table, item.beforeKey) !== identity && recordIdentity(table, item.afterKey) !== identity,
    );
}

export function clearHistory(id) {
  const history = historyForName(id);
  history.undo = [];
  history.redo = [];
}
