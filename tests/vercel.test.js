import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { createLoginThrottle, createVercelHandler } from '../server/vercel.mjs';
import { createSessionAuth } from '../server/session-auth.mjs';

const env = { SIRIS_LOGIN_USER: 'owner', SIRIS_LOGIN_PASSWORD: 'test-password-with-16-characters' };
const authorization = `Basic ${Buffer.from(`${env.SIRIS_LOGIN_USER}:${env.SIRIS_LOGIN_PASSWORD}`).toString('base64')}`;
const tables = [{ name: 'public.rooms', columns: [], primary_keys: ['id'] }];
async function call(app, { url = '/api/meta', method = 'GET', headers = {}, body = undefined } = {}) {
  const req = Object.assign(Readable.from([]), {
    url,
    method,
    headers: { host: 'siris.vercel.app', authorization, ...headers },
  });
  if (body !== undefined) Object.assign(req, { body });
  let status, text;
  /** @type {Record<string, string>} */
  let resultHeaders = {};
  await app(req, {
    writeHead(code, values) {
      status = code;
      resultHeaders = values;
    },
    end(value) {
      text = String(value);
    },
  });
  return { status, headers: resultHeaders, text };
}

describe('Vercel adapter', () => {
  it('expires sessions after eight hours and does not accept forged cookie signatures', () => {
    let time = 1800000000000;
    const auth = createSessionAuth(env.SIRIS_LOGIN_USER, env.SIRIS_LOGIN_PASSWORD, { now: () => time });
    const cookie = auth.sessionCookie().split(';')[0];
    expect(auth.authenticated({ cookie })).toBe(true);
    expect(auth.authenticated({ cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') })).toBe(false);
    time += 8 * 60 * 60 * 1000;
    expect(auth.authenticated({ cookie })).toBe(false);
  });
  it('fails closed until the login is configured', async () => {
    const app = await createVercelHandler({}, tables, process.cwd());
    expect((await call(app)).status).toBe(503);
  });
  it('protects both the interface and API without revealing metadata', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    for (const url of ['/', '/assets/example.js', '/api/meta']) {
      const result = await call(app, { url, headers: { authorization: '' } });
      expect(result.status).toBe(url.startsWith('/api/') ? 401 : 303);
      expect(result.headers['WWW-Authenticate']).toBeUndefined();
      expect(result.text).not.toContain('public.rooms');
    }
  });
  it('shows a login page and explains incorrect credentials without browser challenges', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const form = await call(app, { url: '/auth/login', headers: { authorization: '' } });
    expect(form.status).toBe(200);
    expect(form.text).toContain('autocomplete="current-password"');
    const failed = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://siris.vercel.app' },
      body: { username: env.SIRIS_LOGIN_USER, password: 'wrong' },
    });
    expect(failed.status).toBe(401);
    expect(failed.text).toContain('Tên đăng nhập hoặc mật khẩu chưa đúng');
    expect(failed.headers['WWW-Authenticate']).toBeUndefined();
    expect(failed.headers['Set-Cookie']).toBeUndefined();
  });
  it('logs in once and authenticates HTML and API requests across separate instances by cookie', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const login = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://siris.vercel.app' },
      body: new URLSearchParams({ username: env.SIRIS_LOGIN_USER, password: env.SIRIS_LOGIN_PASSWORD }).toString(),
    });
    expect(login.status).toBe(303);
    expect(login.headers.Location).toBe('/');
    const cookie = login.headers['Set-Cookie'];
    for (const flag of ['__Host-siris_session=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/'])
      expect(cookie).toContain(flag);
    expect(cookie).not.toContain(env.SIRIS_LOGIN_PASSWORD);
    const next = await createVercelHandler(env, tables, process.cwd());
    const meta = await call(next, { headers: { authorization: '', cookie: cookie.split(';')[0] } });
    expect(meta.status).toBe(200);
    expect(JSON.parse(meta.text).tables).toHaveLength(1);
    const tampered = await call(next, { headers: { authorization: '', cookie: cookie.split(';')[0] + 'bad' } });
    expect(tampered.status).toBe(401);
    const rotated = await createVercelHandler(
      { ...env, SIRIS_LOGIN_PASSWORD: 'new-password-long-enough' },
      tables,
      process.cwd(),
    );
    expect((await call(rotated, { headers: { authorization: '', cookie: cookie.split(';')[0] } })).status).toBe(401);
  });
  it('rejects cross-origin login and malformed login bodies', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const input = { username: env.SIRIS_LOGIN_USER, password: env.SIRIS_LOGIN_PASSWORD };
    const cross = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://attacker.example' },
      body: input,
    });
    expect(cross.status).toBe(403);
    expect(cross.headers['Set-Cookie']).toBeUndefined();
    const oversized = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://siris.vercel.app' },
      body: 'a'.repeat(5000),
    });
    expect(oversized.status).toBe(400);
  });
  it('provides the same session across separate function instances and disables caching', async () => {
    const first = await call(await createVercelHandler(env, tables, process.cwd()));
    const second = await call(await createVercelHandler(env, tables, process.cwd()));
    expect(first.status).toBe(200);
    expect(JSON.parse(first.text).token).toBe(JSON.parse(second.text).token);
    expect(first.headers['Cache-Control']).toBe('private, no-store');
  });
  it('rejects cross-origin and tokenless writes', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    for (const origin of [undefined, 'https://attacker.example', 'https://siris.vercel.app']) {
      expect((await call(app, { method: 'POST', headers: origin ? { origin } : {} })).status).toBe(403);
    }
  });
  it('gives each session its own write token', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const first = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://siris.vercel.app' },
      body: new URLSearchParams({ username: env.SIRIS_LOGIN_USER, password: env.SIRIS_LOGIN_PASSWORD }).toString(),
    });
    const second = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { authorization: '', origin: 'https://siris.vercel.app', 'x-forwarded-for': '203.0.113.9' },
      body: new URLSearchParams({ username: env.SIRIS_LOGIN_USER, password: env.SIRIS_LOGIN_PASSWORD }).toString(),
    });
    const cookieA = first.headers['Set-Cookie'].split(';')[0],
      cookieB = second.headers['Set-Cookie'].split(';')[0];
    const tokenA = JSON.parse((await call(app, { headers: { authorization: '', cookie: cookieA } })).text).token;
    const tokenB = JSON.parse((await call(app, { headers: { authorization: '', cookie: cookieB } })).text).token;
    expect(tokenA).not.toBe(tokenB);
    const crossed = await call(app, {
      url: '/api/unknown',
      method: 'POST',
      headers: { authorization: '', cookie: cookieB, origin: 'https://siris.vercel.app', 'x-siris-token': tokenA },
      body: {},
    });
    expect(crossed.status).toBe(403);
  });
  it('throttles repeated failed logins and recovers after the window', () => {
    let time = 0;
    const throttle = createLoginThrottle({ limit: 2, windowMs: 1000, now: () => time });
    throttle.fail('203.0.113.1');
    throttle.fail('203.0.113.1');
    expect(throttle.blocked('203.0.113.1')).toBe(true);
    expect(throttle.blocked('203.0.113.2')).toBe(false);
    time = 1001;
    expect(throttle.blocked('203.0.113.1')).toBe(false);
    throttle.fail('203.0.113.1');
    throttle.clear('203.0.113.1');
    expect(throttle.blocked('203.0.113.1')).toBe(false);
  });
  it('returns 429 after too many wrong passwords from one address', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const attempt = () =>
      call(app, {
        url: '/auth/login',
        method: 'POST',
        headers: { authorization: '', origin: 'https://siris.vercel.app', 'x-forwarded-for': '203.0.113.3' },
        body: { username: env.SIRIS_LOGIN_USER, password: 'wrong' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
  it('counts wrong Basic credentials with the same throttle', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const wrong = `Basic ${Buffer.from(`${env.SIRIS_LOGIN_USER}:wrong`).toString('base64')}`;
    const headers = { 'x-forwarded-for': '203.0.113.4' };
    for (let i = 0; i < 10; i++)
      expect((await call(app, { headers: { ...headers, authorization: wrong } })).status).toBe(401);
    const blocked = await call(app, { headers: { ...headers, authorization: wrong } });
    expect(blocked.status).toBe(429);
    expect(blocked.text).not.toContain('public.rooms');
    // Đúng mật khẩu cũng bị chặn đến khi hết thời gian chờ.
    expect((await call(app, { headers })).status).toBe(429);
    const form = await call(app, {
      url: '/auth/login',
      method: 'POST',
      headers: { ...headers, authorization: '', origin: 'https://siris.vercel.app' },
      body: { username: env.SIRIS_LOGIN_USER, password: env.SIRIS_LOGIN_PASSWORD },
    });
    expect(form.status).toBe(429);
    expect((await call(app, { headers: { 'x-forwarded-for': '203.0.113.5' } })).status).toBe(200);
  });
  it('passes authenticated same-origin requests to the shared routes', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    const { token } = JSON.parse((await call(app)).text);
    const result = await call(app, {
      url: '/api/unknown',
      method: 'POST',
      headers: { origin: 'https://siris.vercel.app', 'x-siris-token': token },
      body: {},
    });
    expect(result.status).toBe(404);
  });
});
