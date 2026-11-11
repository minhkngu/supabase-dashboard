import { $, clearPageCache, state } from './state.js';

export async function api(url, opts = {}) {
  if (opts.method && !['GET', 'HEAD'].includes(opts.method.toUpperCase()) && !url.startsWith('/api/lookup/'))
    clearPageCache();
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
  const d = await r.json();
  if (!r.ok) {
    throw Object.assign(Error(d.error || 'Có lỗi xảy ra'), { status: r.status });
  }
  return d;
}
let toastTimer;
export function toast(msg) {
  $('#toast').textContent = msg;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
export function message(msg, error = false) {
  $('#message').textContent = msg;
  $('#message').className = 'grid-message' + (error ? ' error' : '');
  $('#message').hidden = !msg;
}
