// Vercel entry adapter. Authentication covers HTML, assets and API routes.
import { Readable } from 'node:stream';
import { createApp } from './app.mjs';
import { configFromEnv } from './config.mjs';
import { response } from './http.mjs';
import { createSessionAuth, loginPage, loginValues } from './session-auth.mjs';

// In-memory per instance: enough to slow repeated guessing without adding a
// data store. Each failed attempt is logged without the password.
export function createLoginThrottle({ limit = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map();
  return {
    blocked(ip) {
      const entry = failures.get(ip);
      if (!entry) return false;
      if (entry.resetAt <= now()) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= limit;
    },
    fail(ip) {
      const entry = failures.get(ip);
      if (!entry || entry.resetAt <= now()) failures.set(ip, { count: 1, resetAt: now() + windowMs });
      else entry.count++;
    },
    clear(ip) {
      failures.delete(ip);
    },
  };
}
function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.headers['x-real-ip'] || 'unknown';
}

export async function createVercelHandler(env, tables, root) {
  const user = env.SIRIS_LOGIN_USER;
  const password = env.SIRIS_LOGIN_PASSWORD;
  const ready = Boolean(user && password && password.length >= 16);
  const local = env.SIRIS_AUTH_LOCAL === '1' && !env.VERCEL;
  const auth = createSessionAuth(user, password, { local });
  const throttle = createLoginThrottle();
  const port = 4173;
  const localOrigin = `http://127.0.0.1:${port}`;
  const config = configFromEnv(env, {
    root,
    port,
    csrf: ready ? request => auth.csrf(request.headers) : 'unconfigured',
    session: true,
  });
  const app = await createApp(config, tables, { liveMetadataEachRequest: true });
  return async (req, res) => {
    // Never share an authenticated response through a browser or CDN cache.
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, headers = {}) => writeHead(status, { ...headers, 'Cache-Control': 'private, no-store' });
    if (!ready) return response(res, 503, { error: 'Chưa cấu hình tài khoản truy cập trên Vercel.' });
    const path = new URL(req.url, localOrigin).pathname;
    const origin = req.headers.origin;
    const sameOrigin = `${local ? 'http' : 'https'}://${req.headers.host}`;
    if ((origin && origin !== sameOrigin) || (!['GET', 'HEAD'].includes(req.method) && !origin)) {
      return response(res, 403, { error: 'Nguồn truy cập không hợp lệ' });
    }
    if (path === '/auth/logout' && req.method === 'POST') {
      res.writeHead(303, { Location: '/auth/login', 'Set-Cookie': auth.clearedCookie() });
      return res.end();
    }
    if (path === '/auth/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (throttle.blocked(ip)) {
        console.warn(JSON.stringify({ event: 'login_blocked', ip, at: new Date().toISOString() }));
        return loginPage(res, 429, true);
      }
      try {
        if (!auth.matches(await loginValues(req))) {
          throttle.fail(ip);
          console.warn(JSON.stringify({ event: 'login_failed', ip, at: new Date().toISOString() }));
          return loginPage(res, 401, true);
        }
      } catch {
        throttle.fail(ip);
        console.warn(JSON.stringify({ event: 'login_failed', ip, at: new Date().toISOString() }));
        return loginPage(res, 400, true);
      }
      throttle.clear(ip);
      res.writeHead(303, { Location: '/', 'Set-Cookie': auth.sessionCookie() });
      return res.end();
    }
    let authenticated = auth.sessionValid(req.headers);
    const basic = authenticated ? null : auth.basicCredential(req.headers);
    if (basic !== null) {
      // Basic is checked on every request, so it shares the login throttle.
      const ip = clientIp(req);
      if (throttle.blocked(ip)) {
        console.warn(JSON.stringify({ event: 'login_blocked', ip, at: new Date().toISOString() }));
        if (path.startsWith('/api/'))
          return response(res, 429, { error: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.' });
        return loginPage(res, 429, true);
      }
      if (auth.matches(basic)) {
        throttle.clear(ip);
        authenticated = true;
      } else {
        throttle.fail(ip);
        console.warn(JSON.stringify({ event: 'login_failed', ip, at: new Date().toISOString() }));
      }
    }
    if (path === '/auth/login' && req.method === 'GET' && !authenticated) return loginPage(res);
    if (!authenticated) {
      if (path.startsWith('/api/'))
        return response(res, 401, { error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
      res.writeHead(303, { Location: '/auth/login' });
      return res.end();
    }
    // Vercel may supply a parsed body. Preserve the stream contract used by
    // the shared server, including its size limit and CSRF verification.
    const forwarded =
      req.body === undefined
        ? req
        : Readable.from([
            Buffer.isBuffer(req.body)
              ? req.body
              : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)),
          ]);
    forwarded.method = req.method;
    forwarded.url = req.url;
    forwarded.headers = { ...req.headers, host: `127.0.0.1:${port}`, ...(origin ? { origin: localOrigin } : {}) };
    return app(forwarded, res);
  };
}
