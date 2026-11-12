import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createVercelHandler } from '../server/vercel.mjs';

export const config = { api: { bodyParser: false } };
let pending;

export default async function handler(req, res) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  pending ||= readFile(new URL('../schema.json', import.meta.url), 'utf8')
    .then(text => createVercelHandler(process.env, JSON.parse(text), root))
    .catch(error => {
      pending = null;
      throw error;
    });
  return (await pending)(req, res);
}
