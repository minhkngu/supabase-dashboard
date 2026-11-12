import { $, clearPageCache, invalidateLookupCache, state, el } from './state.js';

export async function api(url, opts = {}) {
  if (opts.method && !['GET', 'HEAD'].includes(opts.method.toUpperCase()) && !url.startsWith('/api/lookup/')) {
    clearPageCache();
    const match = url.match(/^\/api\/table\/([^/?]+)/);
    invalidateLookupCache(match ? decodeURIComponent(match[1]) : null);
  }
  let r;
  try {
    r = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.method ? { 'x-siris-token': state.token } : {}),
        ...opts.headers,
      },
    });
  } catch (error) {
    if (error.name !== 'AbortError') error.network = true;
    throw error;
  }
  // Vercel or a proxy may answer with an HTML error page (504…); report the
  // status instead of a JSON parse error.
  const text = await r.text();
  let d = null;
  try {
    d = text ? JSON.parse(text) : {};
  } catch {}
  if (!r.ok || !d || typeof d !== 'object')
    throw Object.assign(
      Error(d?.error || (r.ok ? 'Máy chủ trả về dữ liệu không hợp lệ.' : `Máy chủ trả về lỗi ${r.status}`)),
      {
        status: r.status,
      },
    );
  return d;
}
let toastTimer;
/**
 * Shows a short status message. An optional action adds a button (for
 * example "Hoàn tác") and keeps the message up a little longer.
 * @param {string} msg
 * @param {{ action?: { label: string, run: () => void } }} [options]
 */
export function toast(msg, { action } = {}) {
  const host = $('#toast'),
    text = el('span', 'toast-text', msg);
  host.replaceChildren(text);
  if (action) {
    const button = el('button', 'toast-action', action.label);
    button.type = 'button';
    button.onclick = () => {
      host.classList.remove('show');
      action.run();
    };
    host.append(button);
  }
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), action ? 6000 : 3500);
}
export function message(msg, error = false) {
  $('#message').textContent = msg;
  $('#message').className = 'grid-message' + (error ? ' error' : '');
  $('#message').hidden = !msg;
}
