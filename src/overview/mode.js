import { PROMOTIONS_TABLE } from '../../table-config.mjs';
import { createPromotionsOverview } from '../../promotions-overview.mjs';
import { createTableOverview } from '../../table-overview.mjs';
import { api } from '../api.js';
import { createCustomSelect } from '../custom-select.js';
import { load } from '../grid/render.js';
import { clearBulk } from '../grid/selection.js';
import { syncChrome } from '../chrome.js';
import { openEditor } from '../record-editor.js';
import { $, deletionBusy, state } from '../state.js';
import { getJSON, getText, setJSON, storageKeys } from '../storage.js';
import { closeViewMenus } from '../view-menus.js';

let overviewMode = false;
export function savedOverviewMode(table) {
  const saved = getJSON(storageKeys.tableDisplay, {});
  const legacy = table.name === PROMOTIONS_TABLE ? getText(storageKeys.promotionsDisplay, '') : null;
  return (saved?.[table.name] ?? legacy) === 'dashboard';
}
function saveOverviewMode(mode) {
  overviewMode = mode;
  const saved = getJSON(storageKeys.tableDisplay, {});
  saved[state.table.name] = mode ? 'dashboard' : 'table';
  setJSON(storageKeys.tableDisplay, saved);
}
export const promotionsOverview = createPromotionsOverview({
  host: $('#promotionsDashboard'),
  api,
  createSelect: createCustomSelect,
  getColumns: () => state.table?.columns || [],
  getTables: () => state.tables,
  onEdit: row => openEditor(row),
  canEdit,
});
export const tableOverview = createTableOverview({
  host: $('#tableDashboard'),
  api,
  getTables: () => state.tables,
  onEdit: row => openEditor(row),
  canEdit,
});
function canEdit() {
  return state.configReady && !deletionBusy && !!state.table?.primary_keys?.length;
}
export function isPromotionsOverview() {
  return !!state.table && overviewMode;
}
// Kept for callers that switch tables or modes; the header itself is derived in syncChrome().
export function syncPromotionsView() {
  syncChrome();
}
export function initMode() {
  $('#promotionsOverviewButton').onclick = () => {
    if (!state.table) return;
    clearBulk();
    closeViewMenus();
    saveOverviewMode(true);
    syncPromotionsView();
    void load();
  };
  $('#promotionsTableButton').onclick = () => {
    promotionsOverview.cancel();
    tableOverview.cancel();
    saveOverviewMode(false);
    syncPromotionsView();
    void load();
  };
}

export function setOverviewMode(value) {
  return (overviewMode = value);
}
