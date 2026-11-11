// Single place that derives the header and toolbar state (shown, hidden,
// disabled) from `state`. Features change `state`, then call syncChrome().
import { PROMOTIONS_TABLE } from '../table-config.mjs';
import { updateHistoryButtons } from './history.js';
import { isPromotionsOverview } from './overview/mode.js';
import { $, deletionBusy, deletionNotice, selectedRecords, state } from './state.js';

export function syncChrome() {
  const table = state.table,
    overview = isPromotionsOverview(),
    isPromo = table?.name === PROMOTIONS_TABLE;
  $('#promotionsViewSwitch').hidden = !table;
  $('#promotionsOverviewButton').setAttribute('aria-pressed', String(overview));
  $('#promotionsTableButton').setAttribute('aria-pressed', String(!overview));
  $('#promotionsDashboard').hidden = !overview || !isPromo;
  $('#tableDashboard').hidden = !overview || isPromo;
  $('.grid-shell').hidden = overview;
  $('.toolbar').hidden = overview;
  $('#ruleChips').hidden = overview || !$('#ruleChips').children.length;
  // Adding works in both modes; undo/redo only concern grid cell edits.
  $('#add').hidden = !table;
  $('#add').disabled = deletionBusy || !state.configReady || !table?.primary_keys?.length;
  $('#undoCell').hidden = overview;
  $('#redoCell').hidden = overview;
  updateHistoryButtons();
  $('#rowSelectionBar').hidden = overview || !(deletionBusy || selectedRecords.size || deletionNotice);
}
