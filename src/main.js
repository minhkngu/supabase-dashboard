import { syncChrome } from './chrome.js';
import { api, message, toast } from './api.js';
import { choose, load, render } from './grid/render.js';
import { updateHistoryButtons } from './history.js';
import { loadLookups, restoreLookups, setLookupCloudAvailable } from './lookup.js';
import { recordFieldHint } from './record-editor.js';
import { loadNativeDisplays } from './relation-display.js';
import { nav, restoreSidebar } from './sidebar.js';
import { $, deletionBusy, name, state, writable } from './state.js';
import { getJSON, getText, setJSON, storageKeys } from './storage.js';
import { restoreViews } from './view-menus.js';

export function syncEditorReadiness() {
  if (!$('#editor').open || !state.table) return;
  const hasKey = !!state.table.primary_keys?.length;
  for (const input of $('#formFields').querySelectorAll('[data-column]')) {
    const c = state.table.columns.find(x => x.name === input.dataset.column);
    if (!c) continue;
    const disabled =
      !state.configReady || !hasKey || !writable(c) || !!(state.edit && state.table.primary_keys.includes(c.name));
    input.disabled = disabled;
    const button = input.closest('.field')?.querySelector('.custom-select-btn');
    if (button) button.disabled = disabled;
    const hint = input.closest('.field')?.querySelector('.field-hint');
    if (hint) hint.textContent = recordFieldHint(c);
  }
  $('#save').disabled = deletionBusy || !state.configReady || !hasKey;
  $('#delete').disabled = deletionBusy || !state.configReady || !hasKey;
}
function showConfigStatus(text, retry = false) {
  const box = $('#configStatus');
  box.hidden = !text;
  $('#configStatusText').textContent = text;
  $('#retryConfig').hidden = !retry;
}
export function scheduleLookupCleanup() {
  if (!state.initialRowsReady || !state.cleanupPending) return;
  state.cleanupPending = false;
  setTimeout(async () => {
    try {
      await api('/api/lookup-config/cleanup-disabled', { method: 'POST', body: '{}' });
      state.lookups = state.lookups.filter(x => !(x.columnBound === true && x.sync?.enabled === false));
    } catch (error) {
      toast('Không thể xóa lookup đã tắt: ' + error.message);
    }
  }, 0);
}
async function loadConfigs(request) {
  const attempt = ++state.configAttempt;
  state.configReady = false;
  showConfigStatus('Đang tải cấu hình cột…');
  syncChrome();
  updateHistoryButtons();
  try {
    const [formula, cloud] = await (request || Promise.all([api('/api/formula-config'), api('/api/lookup-config')]));
    if (attempt !== state.configAttempt) return;
    if (
      !Array.isArray(formula.items) ||
      typeof cloud.available !== 'boolean' ||
      (cloud.available && !Array.isArray(cloud.items))
    )
      throw Error('Cấu hình nhận được không hợp lệ.');
    state.formulas = formula.items;
    setLookupCloudAvailable(cloud.available);
    if (cloud.available) state.lookups = cloud.items;
    state.cleanupPending = state.lookups.some(x => x.columnBound === true && x.sync?.enabled === false);
    state.configReady = true;
    showConfigStatus('');
    syncEditorReadiness();
    if (state.table) {
      syncChrome();
      updateHistoryButtons();
      render();
      loadLookups();
      loadNativeDisplays();
    }
    scheduleLookupCleanup();
  } catch {
    if (attempt !== state.configAttempt) return;
    state.configReady = false;
    syncEditorReadiness();
    showConfigStatus('Không thể tải cấu hình cột. Bảng đang ở chế độ chỉ đọc.', true);
    if (state.table) {
      syncChrome();
      updateHistoryButtons();
      render();
    }
  }
}
export async function initMain() {
  $('#retryConfig').onclick = () => {
    void loadConfigs();
  };
  await initialize();
}

async function initialize() {
  const request = Promise.all([api('/api/formula-config'), api('/api/lookup-config')]);
  request.catch(() => {});
  restoreLookups();
  restoreViews();
  let cachedLoad;
  const current = getText(storageKeys.currentTable, '');
  // Draw the sidebar and load a page from the metadata saved by the previous
  // visit, so data appears without waiting for the metadata round trip.
  const saved = getJSON(storageKeys.metadata, null);
  if (Array.isArray(saved?.tables) && saved.tables.length) {
    state.tables = saved.tables;
    restoreSidebar();
    nav();
    cachedLoad = choose(state.tables.find(t => name(t) === current) || state.tables[0]);
  }
  try {
    const apply = async next => {
      const old = state.table,
        oldName = old && name(old);
      state.tables = next.tables;
      state.adminAvailable = !!next.adminAvailable;
      state.adminError = next.adminError || '';
      state.enumTypes = Array.isArray(next.enumTypes) ? next.enumTypes : [];
      state.token = next.token;
      restoreSidebar();
      nav();
      setJSON(storageKeys.metadata, { tables: state.tables });
      const selected = state.tables.find(t => name(t) === (oldName || current)) || state.tables[0];
      if (!selected) {
        state.table = null;
        message('Không có bảng nào để hiển thị.');
        return;
      }
      if (!old || old.name !== selected.name || JSON.stringify(old) !== JSON.stringify(selected)) choose(selected);
      else if (cachedLoad) {
        await cachedLoad;
        cachedLoad = null;
        if ($('#message').classList.contains('error')) await load({ silent: true });
      }
    };
    await apply(await api('/api/meta'));
    await loadConfigs(request);
  } catch (e) {
    if (!state.table) {
      $('#tables').textContent = 'Không thể tải danh sách bảng';
      message(e.message, true);
    } else showConfigStatus('Không thể xác nhận cấu trúc bảng. Đang ở chế độ chỉ đọc.', true);
  }
}
