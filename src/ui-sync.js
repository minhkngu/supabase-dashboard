// Keeps the interface settings (views, folders, table order…) on Supabase so
// every browser sees the same ones. localStorage stays the working copy: reads
// are instant and the app still works when the server has no settings table.
import { api, toast } from './api.js';
import { state } from './state.js';
import { getJSON, setJSON, setSyncListener, syncedKeys } from './storage.js';

const META_KEY = 'siris-ui-sync-meta';
const PUSH_DELAY = 600;

/** @type {Map<string, any>} */
const pending = new Map();
const timers = new Map();
let serverAvailable = false;
let started = false;
let answered = false;
let noticeShown = false;
// Per key: when this browser last saved or received the value, and whether a
// value existed before this visit. Read once, before the first write.
let meta = {};
let hadLocal = {};
let initialMeta = {};
const keyByStorage = Object.fromEntries(Object.entries(syncedKeys).map(([k, v]) => [v, k]));

function readMeta() {
  const saved = getJSON(META_KEY, {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}
function writeMeta() {
  // Not a synced key, so this never triggers another push.
  setJSON(META_KEY, meta);
}
function hasValue(storageKey) {
  try {
    return localStorage.getItem(storageKey) != null;
  } catch {
    return false;
  }
}

/** Call once before anything reads or writes settings. */
export function beginUiSync() {
  if (started) return;
  started = true;
  meta = readMeta();
  initialMeta = { ...meta };
  for (const [key, storageKey] of Object.entries(syncedKeys)) hadLocal[key] = hasValue(storageKey);
  setSyncListener((storageKey, value) => {
    const key = keyByStorage[storageKey];
    if (!key) return;
    meta[key] = Date.now();
    writeMeta();
    schedulePush(key, value);
  });
}

function schedulePush(key, value) {
  pending.set(key, value);
  if (!serverAvailable) {
    // Said once, when it matters: the person just changed a setting.
    if (answered && !noticeShown) {
      noticeShown = true;
      toast('Cấu hình chỉ lưu trên trình duyệt này.');
    }
    return;
  }
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => void flushKey(key), PUSH_DELAY),
  );
}
async function flushKey(key) {
  if (!pending.has(key)) return;
  const value = pending.get(key);
  pending.delete(key);
  timers.delete(key);
  try {
    const result = await api('/api/ui-settings', { method: 'POST', body: JSON.stringify({ key, value }) });
    if (!pending.has(key) && Number.isFinite(result.updatedAt)) {
      meta[key] = result.updatedAt;
      writeMeta();
    }
  } catch {
    if (!pending.has(key)) pending.set(key, value);
    toast('Chưa lưu được cấu hình giao diện lên máy chủ; sẽ thử lại lần sau.');
  }
}

/** Send whatever is still waiting, even while the page is closing. */
export function flushUiSync() {
  if (!serverAvailable) return;
  for (const [key, value] of pending) {
    clearTimeout(timers.get(key));
    pending.delete(key);
    try {
      void fetch('/api/ui-settings', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'x-siris-token': state.token },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      // Best effort: the local copy is kept and sent on the next visit.
    }
  }
}

export function startUiSyncFlush() {
  addEventListener('pagehide', flushUiSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushUiSync();
  });
}

/**
 * Merge the server's answer with this browser's copy. Returns the keys whose
 * local value was replaced, so the caller can redraw.
 * @param {{ available: boolean, items: Record<string, { value: any, updatedAt: number }> }} remote
 */
export function applyRemoteSettings(remote) {
  const changed = [];
  serverAvailable = !!remote?.available;
  answered = true;
  if (!serverAvailable) return changed;
  const items = remote.items && typeof remote.items === 'object' ? remote.items : {};
  for (const [key, storageKey] of Object.entries(syncedKeys)) {
    const item = items[key];
    if (item && Number.isFinite(item.updatedAt)) {
      const localTime = hadLocal[key] ? initialMeta[key] || 0 : 0;
      if (item.updatedAt > localTime) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(item.value));
        } catch {
          continue;
        }
        meta[key] = item.updatedAt;
        pending.delete(key);
        changed.push(key);
      } else if (localTime > item.updatedAt) schedulePush(key, getJSON(storageKey, null));
    } else if (hadLocal[key] || pending.has(key)) {
      // The server has nothing yet: keep this browser's settings by sending them.
      const value = pending.has(key) ? pending.get(key) : getJSON(storageKey, null);
      if (value !== null) schedulePush(key, value);
    }
  }
  writeMeta();
  // Anything written before the server answered is now free to go.
  for (const key of pending.keys()) schedulePush(key, pending.get(key));
  return changed;
}
