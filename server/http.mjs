// Request and response helpers plus the loopback, origin and CSRF checks.
import pg from 'pg';
import { safeError } from '../admin.mjs';

export function response(res, status, data) {
  const timing = res._sirisStart
    ? { 'Server-Timing': `app;dur=${Number(process.hrtime.bigint() - res._sirisStart) / 1e6}` }
    : {};
  res.writeHead(status, {
    ...timing,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

export async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw Error('Dữ liệu vượt quá 1 MB');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

// Returns [status, message] when the request must be refused, otherwise null.
export function rejectRequest(req, u, { port, csrf }) {
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) return [403, 'Địa chỉ không hợp lệ'];
  if (!u.pathname.startsWith('/api/')) return null;
  const allowedOrigins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ];
  if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return [403, 'Nguồn truy cập không hợp lệ'];
  if (req.method !== 'GET' && !req.headers.origin) return [403, 'Thiếu nguồn truy cập'];
  if (req.method !== 'GET' && req.headers['x-siris-token'] !== csrf) return [403, 'Phiên không hợp lệ'];
  return null;
}

// Postgres errors can expose table internals; map them to safe messages.
export function sendError(res, error) {
  const message = error instanceof pg.DatabaseError ? safeError(error) : error.message || 'Có lỗi xảy ra';
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 400;
  response(res, status, { error: message });
}
