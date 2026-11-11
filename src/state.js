import { isWritableColumn } from '../writable-column.mjs';

export let deletionBusy = false,
  deletionTable = null,
  deletionProgress = '',
  deletionNotice = '';
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
  tables: [],
  table: null,
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
  lookups: [],
  lookupResults: new Map(),
  lookupVersion: 0,
  lookupEditing: null,
  history: new Map(),
  historyBusy: false,
  adminAvailable: false,
  adminError: '',
  enumTypes: [],
  configReady: false,
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
export const pageCache = new Map();
// Key (table, search, filters) whose total row count is already known; page
// changes within it skip the count query. Any write clears it with the cache.
export let countedKey = null;
export function clearPageCache() {
  pageCache.clear();
  countedKey = null;
}
export let loadController = null;
export function setDeletionNotice(value) {
  return (deletionNotice = value);
}

export function setDeletionBusy(value) {
  return (deletionBusy = value);
}

export function setDeletionTable(value) {
  return (deletionTable = value);
}

export function setDeletionProgress(value) {
  return (deletionProgress = value);
}

export function setLoadController(value) {
  return (loadController = value);
}

export function setCountedKey(value) {
  return (countedKey = value);
}
