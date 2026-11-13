import { historyBusy } from './history-state.js';
import { getFormulas, getLookups, getConfigReady } from './config-state.js';
import { getTables, getTable, getEnumTypes } from './metadata-state.js';
import { deletionBusy } from './deletion-state.js';
export * from './deletion-state.js';
export * from './grid/cache-state.js';
import { isWritableColumn } from '../writable-column.mjs';

export const selectedRecords = new Map();
export const pendingRows = new WeakSet();
// Columns of each row whose new value is being saved, shown as saving.
/** @type {WeakMap<object, Set<string>>} */
export const savingCells = new WeakMap();
// Rows per grid page; the server accepts the same default.
export const PAGE_SIZE = 50;
// Page sizes offered in the grid footer; the choice is saved per table.
export const PAGE_SIZES = [50, 100, 200];
export function pageSize() {
  return state.view?.pageSize || PAGE_SIZE;
}
/** @type {(selector: string) => any} */
export const $ = s => document.querySelector(s);
/** @type {(selector: string, root?: ParentNode) => any[]} */
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const state = {
  get tables() {
    return getTables();
  },
  get table() {
    return getTable();
  },
  rows: [],
  page: 0,
  total: 0,
  token: '',
  direction: 'asc',
  edit: null,
  collapsed: new Set(),
  folders: [],
  tableFolders: {},
  tableLabels: {},
  groupCounts: null,
  get lookups() {
    return getLookups();
  },
  get formulas() {
    return getFormulas();
  },
  lookupResults: new Map(),
  lookupVersion: 0,
  lookupEditing: null,
  get historyBusy() {
    return historyBusy();
  },
  adminAvailable: false,
  adminError: '',
  get enumTypes() {
    return getEnumTypes();
  },
  get configReady() {
    return getConfigReady();
  },
  configAttempt: 0,
  initialRowsReady: false,
  cleanupPending: false,
  views: {},
  view: null,
  loadVersion: 0,
};
export const name = t => t.name.replace(/^public\./, '');
export const writable = c =>
  !deletionBusy &&
  state.configReady &&
  isWritableColumn(state.table, c, { formulas: state.formulas, lookups: state.lookups });
export function el(tag, cls, text) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
}
