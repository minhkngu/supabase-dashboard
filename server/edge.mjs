// Entry used by the Supabase edge function (see scripts/edge-files.mjs). It
// runs the same request handler as the local server with edge settings.
import { createApp } from './app.mjs';
import { configFromEnv } from './config.mjs';

// The Sites proxy talks to every edge isolate with this token; requests are
// already authenticated by the Ed25519 signature checked in index.ts.
export const EDGE_SESSION_TOKEN = 'siris-sites-private';
// index.ts forwards each request as if it came from this local address.
export const EDGE_PORT = 4173;

/**
 * @param {Record<string, string>} env the function's environment
 * @param {any[]} tables saved schema.json metadata
 */
export function createEdgeHandler(env, tables) {
  const config = configFromEnv(
    { ...env, SUPABASE_KEY: env.SUPABASE_ANON_KEY || env.SUPABASE_KEY },
    { port: EDGE_PORT, csrf: EDGE_SESSION_TOKEN },
  );
  return createApp(config, tables, { serveFiles: false, liveMetadataEachRequest: true });
}
