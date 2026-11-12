// Every localStorage key used by the interface lives here. Reads and writes
// never throw: a browser with storage disabled falls back to the default or
// simply skips saving.
export const STORAGE_VERSION = 1;

export const storageKeys = {
  currentTable: 'siris-current-table',
  metadata: 'siris-metadata-v1',
  views: 'siris-views-v1',
  namedViews: 'siris-named-views-v1',
  lookups: 'siris-lookups-v1',
  relationDisplay: 'siris-relation-display-v1',
  tableDisplay: 'siris-table-display-v1',
  promotionsDisplay: 'siris-promotions-display-v1',
  tableOrder: 'siris-table-order',
  tableFolders: 'siris-table-folders',
  sidebarCollapsed: 'siris-sidebar-collapsed',
};

// Keys shared through the server (see ui-sync.js). Writes to them notify the
// listener so they can be sent to Supabase; other keys stay in this browser.
export const syncedKeys = {
  views: storageKeys.views,
  namedViews: storageKeys.namedViews,
  tableFolders: storageKeys.tableFolders,
  tableOrder: storageKeys.tableOrder,
  relationDisplay: storageKeys.relationDisplay,
  tableDisplay: storageKeys.tableDisplay,
};
let syncListener = null;
export function setSyncListener(fn) {
  syncListener = fn;
}

export function getJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  syncListener?.(key, value);
  return true;
}

export function getText(key, fallback = '') {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setText(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; nothing to clean up.
  }
}

// Keys created from a name get the current schema version.
export function storageKey(name) {
  return `siris-${name}-v${STORAGE_VERSION}`;
}
