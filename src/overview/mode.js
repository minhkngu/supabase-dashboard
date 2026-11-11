import { createPromotionsOverview } from '../../promotions-overview.mjs';
import { createTableOverview } from '../../table-overview.mjs';
import { api } from '../api.js';
import { createCustomSelect } from '../custom-select.js';
import { load } from '../grid/render.js';
import { clearBulk } from '../main.js';
import { $, deletionBusy, deletionNotice, selectedRecords, state } from '../state.js';
import { closeViewMenus } from '../view-menus.js';

let promotionsMode = false;
export function savedPromotionsMode(table) {
  try {
    const saved = JSON.parse(localStorage.getItem('siris-table-display-v1') || '{}');
    return (
      (saved[table.name] ??
        (table.name === 'public.promotions' ? localStorage.getItem('siris-promotions-display-v1') : null)) ===
      'dashboard'
    );
  } catch {
    return false;
  }
}
function savePromotionsMode(mode) {
  promotionsMode = mode;
  try {
    const saved = JSON.parse(localStorage.getItem('siris-table-display-v1') || '{}');
    saved[state.table.name] = mode ? 'dashboard' : 'table';
    localStorage.setItem('siris-table-display-v1', JSON.stringify(saved));
  } catch {}
}
export const promotionsOverview = createPromotionsOverview({
  host: $('#promotionsDashboard'),
  api,
  createSelect: createCustomSelect,
  getColumns: () => state.table?.columns || [],
  getTables: () => state.tables,
});
export const tableOverview = createTableOverview({ host: $('#tableDashboard'), api, getTables: () => state.tables });
export function isPromotionsOverview() {
  return !!state.table && promotionsMode;
}
export function syncPromotionsView() {
  const available = !!state.table,
    overview = available && promotionsMode,
    isPromo = state.table?.name === 'public.promotions';
  $('#promotionsViewSwitch').hidden = !available;
  $('#promotionsDashboard').hidden = !overview || !isPromo;
  $('#tableDashboard').hidden = !overview || isPromo;
  $('.grid-shell').hidden = overview;
  $('.toolbar').hidden = overview;
  $('#undoCell').hidden = overview;
  $('#redoCell').hidden = overview;
  $('#add').hidden = overview;
  $('#rowSelectionBar').hidden = overview || !(deletionBusy || selectedRecords.size || deletionNotice);
  $('#promotionsOverviewButton').setAttribute('aria-pressed', String(overview));
  $('#promotionsTableButton').setAttribute('aria-pressed', String(!overview));
}
export function initMode() {
  $('#promotionsOverviewButton').onclick = () => {
    if (!state.table) return;
    clearBulk();
    closeViewMenus();
    savePromotionsMode(true);
    syncPromotionsView();
    void load();
  };
  $('#promotionsTableButton').onclick = () => {
    promotionsOverview.cancel();
    tableOverview.cancel();
    savePromotionsMode(false);
    syncPromotionsView();
    void load();
  };
}

export function setPromotionsMode(value) {
  return (promotionsMode = value);
}
