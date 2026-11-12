// Local preview of the deployed authentication flow; binds to loopback only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.mjs';
import { createVercelHandler } from '../server/vercel.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const credentials = Object.fromEntries(
  (await readFile(new URL('../.env.vercel.local', import.meta.url), 'utf8'))
    .trim()
    .split('\n')
    .map(line => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const tables = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
const handler = await createVercelHandler(
  { ...loadConfig(root).env, ...credentials, VERCEL: '', SIRIS_AUTH_LOCAL: '1' },
  tables,
  root,
);
http
  .createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Không thể xử lý yêu cầu.');
    });
  })
  .listen(3002, '127.0.0.1', () => console.log('Siris login preview: http://127.0.0.1:3002'));
