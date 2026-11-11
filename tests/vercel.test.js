import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { createVercelHandler } from '../server/vercel.mjs';

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
  it('fails closed until the login is configured', async () => {
    const app = await createVercelHandler({}, tables, process.cwd());
    expect((await call(app)).status).toBe(503);
  });
  it('protects both the interface and API without revealing metadata', async () => {
    const app = await createVercelHandler(env, tables, process.cwd());
    for (const url of ['/', '/assets/example.js', '/api/meta']) {
      const result = await call(app, { url, headers: { authorization: '' } });
      expect(result.status).toBe(401);
      expect(result.headers['WWW-Authenticate']).toContain('Basic');
      expect(result.text).not.toContain('public.rooms');
    }
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
