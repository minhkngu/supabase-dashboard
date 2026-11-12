// Local server: binds to loopback and keeps Supabase credentials server-side.
// The request handling itself is shared with the Vercel function (server/app.mjs).
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './server/config.mjs';
import { createApp } from './server/app.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(root);
const tables = JSON.parse(await readFile(path.join(root, 'schema.json'), 'utf8'));
const server = http.createServer(await createApp(config, tables));
server.listen(config.port, '127.0.0.1', () => console.log(`Siris Base: http://127.0.0.1:${config.port}`));
