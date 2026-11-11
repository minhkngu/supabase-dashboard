// Vercel entry adapter. Authentication covers HTML, assets and API routes.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from './app.mjs';
import { configFromEnv } from './config.mjs';
import { response } from './http.mjs';

export async function createVercelHandler(env, tables, root) {
  const user = env.SIRIS_LOGIN_USER;
  const password = env.SIRIS_LOGIN_PASSWORD;
  const ready = Boolean(user && password && password.length >= 16);
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest(`${user}:${password}`);
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
    const authorization = req.headers.authorization || '';
    const supplied = /^Basic /i.test(authorization) ? Buffer.from(authorization.slice(6), 'base64').toString() : '';
    if (!timingSafeEqual(expected, digest(supplied))) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Siris", charset="UTF-8"' });
      return res.end('Vui lòng đăng nhập Siris.');
    }
    const origin = req.headers.origin;
    const sameOrigin = `https://${req.headers.host}`;
    if ((origin && origin !== sameOrigin) || (!['GET', 'HEAD'].includes(req.method) && !origin)) {
      return response(res, 403, { error: 'Nguồn truy cập không hợp lệ' });
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
