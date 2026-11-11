import { deleteRecordBatch, recordIdentity } from '../record-deletion.mjs';
import { api, toast } from './api.js';
import { load, render } from './grid/render.js';
import { bulkBusy, clearBulk } from './grid/selection.js';
import { updateHistoryButtons } from './history.js';
import { syncEditorReadiness } from './main.js';
import { isPromotionsOverview, promotionsOverview } from './overview/mode.js';
import {
  $,
  clearPageCache,
  deletionBusy,
  deletionNotice,
  deletionProgress,
  el,
  loadController,
  name,
  pendingRows,
  selectedRecords,
  setDeletionBusy,
  setDeletionNotice,
  setDeletionProgress,
  setDeletionTable,
  state,
} from './state.js';
import { persistView } from './view-menus.js';

function toggleRecordSelection(row, checked) {
  if (deletionBusy) return;
  const identity = recordIdentity(state.table, row);
  if (!identity) return;
  if (checked) selectedRecords.set(identity, row);
  else selectedRecords.delete(identity);
  updateRowSelection();
}
function toggleManyRecordSelection(rows, checked) {
  if (deletionBusy) return;
  for (const row of rows) {
    const identity = recordIdentity(state.table, row);
    if (!identity) continue;
    if (checked) selectedRecords.set(identity, row);
    else selectedRecords.delete(identity);
  }
  updateRowSelection();
}
export function rowCheckbox(row, index) {
  const input = el('input', 'row-select');
  input.type = 'checkbox';
  input.dataset.rowSelect = String(index);
  input.setAttribute('aria-label', `Chọn dòng ${state.page * 50 + index + 1}`);
  input.onclick = event => event.stopPropagation();
  return input;
}
export function rowSelectionHeader() {
  const head = el('th', 'row-selection-header');
  if (!state.table?.primary_keys?.length) {
    head.textContent = '#';
    return head;
  }
  const input = el('input', 'row-select');
  input.type = 'checkbox';
  input.dataset.rowsSelectAll = '';
  input.setAttribute('aria-label', 'Chọn tất cả dòng hiển thị trên trang');
  input.onclick = event => event.stopPropagation();
  head.append(input);
  return head;
}
export function updateRowSelection() {
  const bar = $('#rowSelectionBar'),
    active = deletionBusy || selectedRecords.size > 0 || !!deletionNotice;
  bar.hidden = !active || isPromotionsOverview();
  $('#rowSelectionSummary').textContent = deletionBusy ? deletionProgress : `Đã chọn ${selectedRecords.size} dòng`;
  $('#deleteSelectedRows').disabled = deletionBusy || !state.configReady || !selectedRecords.size;
  $('#add').disabled = deletionBusy || !state.configReady || !state.table?.primary_keys?.length;
  $('#clearRowSelection').disabled = deletionBusy;
  $('#deleteSelectedRows').textContent = deletionBusy ? 'Đang xóa…' : `Xóa ${selectedRecords.size || ''} dòng đã chọn`;
  $('#rowDeleteResults').hidden = !deletionNotice;
  $('#rowDeleteResults').textContent = deletionNotice;
  const inputs = [...document.querySelectorAll('#grid input[data-row-select]')];
  for (const input of inputs) {
    const row = state.rows[Number(input.dataset.rowSelect)],
      identity = recordIdentity(state.table, row);
    input.checked = !!identity && selectedRecords.has(identity);
    input.disabled = deletionBusy || !identity;
    input.closest('tr')?.classList.toggle('record-selected', input.checked);
  }
  const header = $('#grid input[data-rows-select-all]');
  if (header) {
    const eligible = inputs.filter(input => recordIdentity(state.table, state.rows[Number(input.dataset.rowSelect)])),
      count = eligible.filter(input => input.checked).length;
    header.checked = eligible.length > 0 && count === eligible.length;
    header.indeterminate = count > 0 && count < eligible.length;
    header.disabled = deletionBusy || !eligible.length;
  }
  promotionsOverview.syncSelection();
}
export function initDeletion() {
  $('#grid').addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-row-select]'))
      toggleRecordSelection(state.rows[Number(input.dataset.rowSelect)], input.checked);
    else if (input.matches('[data-rows-select-all]'))
      toggleManyRecordSelection(
        [...document.querySelectorAll('#grid input[data-row-select]')].map(
          input => state.rows[Number(input.dataset.rowSelect)],
        ),
        input.checked,
      );
  });
  $('#clearRowSelection').onclick = () => {
    selectedRecords.clear();
    setDeletionNotice('');
    updateRowSelection();
  };
  $('#deleteSelectedRows').onclick = () => void deleteRecords([...selectedRecords.values()]);
}

export async function refreshAfterWrite(table = state.table) {
  if (!table || state.table?.name !== table.name) return;
  const scroller = $('.table-scroll'),
    top = scroller?.scrollTop || 0,
    left = scroller?.scrollLeft || 0;
  await load({ silent: true });
  if (state.table?.name === table.name && scroller?.isConnected) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
}
export async function deleteRecords(rows) {
  if (deletionBusy || !state.configReady || !state.table || !rows.length) return;
  const table = state.table,
    records = rows.slice();
  if (state.rows.some(row => pendingRows.has(row)) || state.historyBusy || bulkBusy || state.cellEdit) {
    toast('Hãy chờ lưu hoặc hoàn tất sửa ô trước khi xóa.');
    return;
  }
  if (records.some(row => !recordIdentity(table, row))) {
    toast('Bản ghi thiếu khóa chính để xóa.');
    return;
  }
  if (!confirm(`Xóa ${records.length} dòng trong bảng ${name(table)} khỏi Supabase? Thao tác này không thể hoàn tác.`))
    return;
  setDeletionBusy(true);
  setDeletionTable(table);
  setDeletionNotice('');
  setDeletionProgress(`Đang chuẩn bị xóa ${records.length} dòng trong ${name(table)}…`);
  if (isPromotionsOverview() && state.table.name === 'public.promotions') state.total = promotionsOverview.total();
  loadController?.abort();
  state.loadVersion++;
  promotionsOverview.cancel();
  clearBulk();
  clearPageCache();
  $('#add').disabled = true;
  updateHistoryButtons();
  syncEditorReadiness();
  render();
  updateRowSelection();
  let result;
  try {
    result = await deleteRecordBatch({
      api,
      table,
      rows: records,
      onProgress: (current, total) => {
        setDeletionProgress(`Đang xóa ${current}/${total} dòng trong ${name(table)}…`);
        updateRowSelection();
      },
      onDeleted: entry => {
        clearPageCache();
        const history = state.history.get(name(table));
        if (history)
          for (const direction of ['undo', 'redo'])
            history[direction] = history[direction].filter(
              item =>
                recordIdentity(table, item.beforeKey) !== entry.identity &&
                recordIdentity(table, item.afterKey) !== entry.identity,
            );
        if (state.table?.name !== table.name) return;
        loadController?.abort();
        state.loadVersion++;
        promotionsOverview.cancel();
        selectedRecords.delete(entry.identity);
        state.rows = state.rows.filter(row => recordIdentity(table, row) !== entry.identity);
        state.total = Math.max(0, state.total - 1);
        if ($('#editor').open && recordIdentity(table, state.edit) === entry.identity) {
          $('#editor').close();
          state.edit = null;
        }
        if (table.name === 'public.promotions') promotionsOverview.removeRecord(entry.row);
        render();
        updateRowSelection();
      },
    });
    const problems = result.failed.map(entry => `${entry.row.name ?? JSON.stringify(entry.key)}: ${entry.message}`);
    if (result.uncertain)
      problems.push(
        `${result.uncertain.row.name ?? JSON.stringify(result.uncertain.key)}: Chưa xác nhận được kết quả xóa. ${result.uncertain.message} Kiểm tra dữ liệu trước khi thử lại.`,
      );
    if (result.unattempted.length) problems.push(`${result.unattempted.length} dòng chưa được gửi yêu cầu xóa.`);
    if (state.table?.name === table.name) {
      setDeletionNotice(
        problems.length ? `Đã xóa ${result.deleted.length}/${result.total} dòng. ${problems.join(' · ')}` : '',
      );
      if (
        $('#editor').open &&
        problems.length &&
        records.some(row => recordIdentity(table, row) === recordIdentity(table, state.edit))
      )
        $('#formError').textContent = deletionNotice;
    }
    toast(
      problems.length
        ? `Đã xóa ${result.deleted.length}/${result.total} dòng trong ${name(table)}; có dòng cần kiểm tra.`
        : `Đã xóa ${result.deleted.length} dòng trong ${name(table)}`,
    );
  } catch (error) {
    setDeletionNotice(`Không thể hoàn tất thao tác xóa: ${error.message}`);
    toast(deletionNotice);
  } finally {
    setDeletionBusy(false);
    setDeletionTable(null);
    clearPageCache();
    $('#add').disabled = !state.configReady || !state.table?.primary_keys?.length;
    updateHistoryButtons();
    syncEditorReadiness();
    render();
    updateRowSelection();
  }
  if (state.table?.name === table.name) {
    state.page = Math.max(0, Math.min(state.page, Math.ceil(state.total / 50) - 1));
    persistView();
    await refreshAfterWrite(table);
  }
}
