// Server configuration: .env.local, Supabase endpoint and the optional
// PostgreSQL connection used for schema, lookup and formula management.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(x => /^\s*[A-Za-z_][\w]*\s*=/.test(x))
      .map(x => {
        const i = x.indexOf('=');
        return [
          x.slice(0, i).trim(),
          x
            .slice(i + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

function adminConnection(env, url) {
  if (!env.SUPABASE_DB_URL) return { url: null, error: 'Cần cấu hình SUPABASE_DB_URL trên máy chủ để quản lý cột.' };
  try {
    const apiHost = new URL(url).hostname,
      match = apiHost.match(/^([a-z0-9]+)\.supabase\.co$/i),
      db = new URL(env.SUPABASE_DB_URL);
    if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw Error();
    if (
      match &&
      db.hostname !== `db.${match[1]}.supabase.co` &&
      !decodeURIComponent(db.username).endsWith('.' + match[1])
    )
      return { url: null, error: 'Kết nối database không khớp với dự án Supabase hiện tại.' };
    return { url: env.SUPABASE_DB_URL, error: '' };
  } catch {
    return { url: null, error: 'SUPABASE_DB_URL hoặc địa chỉ Supabase không hợp lệ.' };
  }
}

// Local server: reads .env.local and the process environment.
export function loadConfig(root) {
  return configFromEnv({ ...envFile(path.join(root, '.env.local')), ...process.env }, { root });
}

// Shared by the local server and the Vercel function, which passes its own
// environment, a fixed port and a session token.
export function configFromEnv(env, { root = '', port = Number(env.PORT || 4173), csrf = null, session = false } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    key = env.SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY;
  return {
    root,
    env,
    url,
    key,
    port,
    csrf,
    // Signed-in deployment (Vercel): the interface offers a logout button.
    session,
    perfTiming: env.SIRIS_PERF_TIMING === '1',
    admin: adminConnection(env, url),
  };
}
