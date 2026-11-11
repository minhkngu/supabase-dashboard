// Local server: binds to loopback, keeps Supabase credentials server-side and
// routes same-origin API calls. Route handlers live in server/routes/.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './server/config.mjs';
import { createContext } from './server/context.mjs';
import { rejectRequest, response, sendError } from './server/http.mjs';
import { serveStatic } from './server/static.mjs';
import { handleMeta } from './server/routes/meta.mjs';
import { handleFormula } from './server/routes/formula.mjs';
import { handleLookup } from './server/routes/lookup.mjs';
import { handleSchema } from './server/routes/schema.mjs';
import { handleTable } from './server/routes/table.mjs';
import { invalidatesCaches } from './server-cache.mjs';

const config = loadConfig(path.dirname(fileURLToPath(import.meta.url)));
const ctx = await createContext(config);
const routes = [handleMeta, handleFormula, handleLookup, handleSchema, handleTable];

const server = http.createServer(async (req, res) => {
  if (config.perfTiming) res._sirisStart = process.hrtime.bigint();
  try {
    const u = new URL(req.url, `http://127.0.0.1:${config.port}`);
    const rejected = rejectRequest(req, u, { port: config.port, csrf: ctx.csrf });
    if (rejected) return response(res, rejected[0], { error: rejected[1] });
    if (!u.pathname.startsWith('/api/')) return await serveStatic(config.root, req, res, u);
    if (invalidatesCaches(req.method, u.pathname)) ctx.invalidateCaches();
    for (const route of routes) if (await route(ctx, req, res, u)) return;
    response(res, 404, { error: 'Không tìm thấy' });
  } catch (error) {
    sendError(res, error);
  }
});
server.listen(config.port, '127.0.0.1', () => console.log(`Siris Base: http://127.0.0.1:${config.port}`));
