import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDGE_BACKEND, EDGE_FILES, missingEdgeImports, relativeImports } from '../scripts/edge-files.mjs';
import { createEdgeHandler, EDGE_PORT, EDGE_SESSION_TOKEN } from '../server/edge.mjs';

// Calls the handler the way supabase/functions/siris-manager/index.ts does.
function call(handler, { method = 'GET', path, token = '', body = '' }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: `127.0.0.1:${EDGE_PORT}`, origin: `http://127.0.0.1:${EDGE_PORT}`, 'x-siris-token': token },
      async *[Symbol.asyncIterator]() {
        if (body) yield Buffer.from(body);
      },
    };
    let status = 200;
    const res = {
      writeHead(code) {
        status = code;
      },
      end(text) {
        resolve({ status, data: JSON.parse(text) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

describe('edge function', () => {
  it('copies every module the shared handler imports', () => {
    expect(missingEdgeImports()).toEqual([]);
    expect(relativeImports("import a from './a.mjs';\nimport { b } from '../b.mjs';")).toEqual(['./a.mjs', '../b.mjs']);
    for (const target of relativeImports(EDGE_BACKEND)) expect(EDGE_FILES).toContain(target.replace(/^\.\//, ''));
  });

  it('local server and edge function share the same handler', () => {
    expect(readFileSync('server.mjs', 'utf8')).toContain("from './server/app.mjs'");
    expect(readFileSync('server/edge.mjs', 'utf8')).toContain("from './app.mjs'");
    expect(EDGE_BACKEND).toContain('export const handler');
    expect(EDGE_BACKEND).not.toMatch(/createServer|listen\(/);
  });

  it('answers API calls with the fixed session token and serves no files', async () => {
    const handler = await createEdgeHandler({}, [{ name: 'public.rooms', columns: [], primary_keys: ['id'] }]);
    const meta = await call(handler, { path: '/api/meta' });
    expect(meta.status).toBe(200);
    expect(meta.data.token).toBe(EDGE_SESSION_TOKEN);
    expect(meta.data.tables.map(t => t.name)).toEqual(['public.rooms']);
    const forged = await call(handler, { method: 'POST', path: '/api/table/rooms', token: 'other', body: '{}' });
    expect(forged.status).toBe(403);
    expect((await call(handler, { path: '/' })).status).toBe(404);
  });
});
