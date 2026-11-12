// Serves the built interface from dist/ with a strict CSP.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { response } from './http.mjs';

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
};
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

export async function serveStatic(root, req, res, u) {
  if (req.method !== 'GET') return response(res, 405, { error: 'Không hỗ trợ' });
  const f =
    u.pathname === '/'
      ? 'index.html'
      : /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2)$/.test(u.pathname)
        ? u.pathname.slice(1)
        : null;
  if (!f) return response(res, 404, { error: 'Không tìm thấy' });
  const file = path.join(root, 'dist', f);
  if (!existsSync(file)) return response(res, 404, { error: 'Chưa có giao diện đã build. Chạy npm run build.' });
  const content = await readFile(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(f)],
    'Cache-Control': f.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
  });
  res.end(content);
}
