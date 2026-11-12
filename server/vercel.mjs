// Vercel entry adapter. Authentication covers HTML, assets and API routes.
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from './app.mjs';
import { configFromEnv } from './config.mjs';
import { response } from './http.mjs';
import { createSessionAuth, loginPage, loginValues } from './session-auth.mjs';

export async function createVercelHandler(env, tables, root) {
  const user = env.SIRIS_LOGIN_USER;
  const password = env.SIRIS_LOGIN_PASSWORD;
  const ready = Boolean(user && password && password.length >= 16);
  const local = env.SIRIS_AUTH_LOCAL === '1' && !env.VERCEL;
  const auth = createSessionAuth(user, password, { local });
  const port = 4173;
  const localOrigin = `http://127.0.0.1:${port}`;
  const config = configFromEnv(env, {
    root,
    port,
    csrf: ready ? createHmac('sha256', password).update('siris-vercel-csrf').digest('hex') : 'unconfigured',
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
    if (path === '/auth/login' && req.method === 'POST') {
      try {
        if (!auth.matches(await loginValues(req))) return loginPage(res, 401, true);
      } catch {
        return loginPage(res, 400, true);
      }
      res.writeHead(303, { Location: '/', 'Set-Cookie': auth.sessionCookie() });
      return res.end();
    }
    const authenticated = auth.authenticated(req.headers);
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
