// The request handler shared by the local server (server.mjs) and the
// Supabase edge function (supabase/functions/siris-manager/backend.mjs).
import process from 'node:process';
import { createContext } from './context.mjs';
import { rejectRequest, response, sendError } from './http.mjs';
import { serveStatic } from './static.mjs';
import { handleMeta } from './routes/meta.mjs';
import { handleFormula } from './routes/formula.mjs';
import { handleLookup } from './routes/lookup.mjs';
import { handleSchema } from './routes/schema.mjs';
import { handleTable } from './routes/table.mjs';
import { invalidatesCaches } from '../server-cache.mjs';

const routes = [handleMeta, handleFormula, handleLookup, handleSchema, handleTable];

/**
 * @param {ReturnType<typeof import('./config.mjs').configFromEnv>} config
 * @param {any[]} tables saved schema.json metadata
 * @param {{ serveFiles?: boolean, liveMetadataEachRequest?: boolean }} [options]
 *   serveFiles: serve the built interface from dist/ (local server only).
 *   liveMetadataEachRequest: load live metadata before every API call; an
 *   edge isolate may answer a request before /api/meta has ever run there.
 */
export async function createApp(config, tables, { serveFiles = true, liveMetadataEachRequest = false } = {}) {
  const ctx = await createContext(config, tables);
  return async function handler(req, res) {
    if (config.perfTiming) Object.assign(res, { _sirisStart: process.hrtime.bigint() });
    try {
      const u = new URL(req.url, `http://127.0.0.1:${config.port}`);
      const rejected = rejectRequest(req, u, { port: config.port, csrf: ctx.csrf });
      if (rejected) return response(res, rejected[0], { error: rejected[1] });
      if (!u.pathname.startsWith('/api/')) {
        if (serveFiles) return await serveStatic(config.root, req, res, u);
        return response(res, 404, { error: 'Không tìm thấy' });
      }
      if (
        invalidatesCaches(req.method, u.pathname) ||
        (req.method === 'GET' && u.pathname === '/api/meta' && u.searchParams.get('refresh') === '1')
      )
        ctx.invalidateCaches();
      if (liveMetadataEachRequest && ctx.admin.enabled) ctx.tables = (await ctx.cachedMetadata()).tables;
      for (const route of routes) if (await route(ctx, req, res, u)) return;
      response(res, 404, { error: 'Không tìm thấy' });
    } catch (error) {
      sendError(res, error);
    }
  };
}
