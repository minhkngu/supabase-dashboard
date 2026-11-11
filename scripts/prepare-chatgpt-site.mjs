// Prepares the private online version: copies the shared server modules into
// the Supabase edge function and bundles the built interface for the Sites
// worker in chatgpt-site/ (a separate repository). Run `npm run build` first.
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { EDGE_BACKEND, EDGE_DIR, EDGE_FILES, STALE_EDGE_FILES, missingEdgeImports } from './edge-files.mjs';

const missing = missingEdgeImports();
if (missing.length) throw Error(`Edge function would miss imported files:\n${missing.join('\n')}`);
for (const file of EDGE_FILES) if (!existsSync(file)) throw Error(`Missing source file for the edge function: ${file}`);
if (!existsSync('dist/index.html')) throw Error('Run npm run build before preparing the site.');
if (!existsSync('chatgpt-site/worker/proxy.js')) throw Error('chatgpt-site/worker/proxy.js not found.');

await mkdir(EDGE_DIR, { recursive: true });
let publicKey;
try {
  publicKey = JSON.parse(await readFile('chatgpt-site/bridge-public.json', 'utf8'));
} catch {
  const pair = generateKeyPairSync('ed25519');
  publicKey = pair.publicKey.export({ format: 'jwk' });
  await writeFile(
    'chatgpt-site/.env.bridge',
    JSON.stringify(pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')),
    { mode: 0o600 },
  );
  await writeFile('chatgpt-site/bridge-public.json', JSON.stringify(publicKey));
}
for (const file of EDGE_FILES) {
  await mkdir(path.dirname(path.join(EDGE_DIR, file)), { recursive: true });
  await copyFile(file, path.join(EDGE_DIR, file));
}
for (const file of STALE_EDGE_FILES) await rm(path.join(EDGE_DIR, file), { force: true });
await writeFile(`${EDGE_DIR}/backend.mjs`, EDGE_BACKEND);
await writeFile(`${EDGE_DIR}/deno.json`, JSON.stringify({ imports: { pg: 'npm:pg@8.16.3' }, nodeModulesDir: 'auto' }));
await writeFile(`${EDGE_DIR}/bridge-public.json`, JSON.stringify(publicKey));

const types = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
};
const assets = {};
for (const file of ['index.html', ...(await readdir('dist/assets')).map(x => 'assets/' + x)]) {
  const type = types[path.extname(file)];
  if (!type) throw Error(`No content type for built file ${file}`);
  assets['/' + (file === 'index.html' ? '' : file)] = {
    body: (await readFile('dist/' + file)).toString('base64'),
    type,
  };
}
await writeFile('chatgpt-site/worker/assets.js', `export default ${JSON.stringify(assets)};\n`);
const proxy = await readFile('chatgpt-site/worker/proxy.js', 'utf8'),
  importLine = "import assets from './assets.js';";
if (!proxy.includes(importLine)) throw Error(`chatgpt-site/worker/proxy.js no longer contains: ${importLine}`);
await writeFile('chatgpt-site/worker/index.js', proxy.replace(importLine, `const assets=${JSON.stringify(assets)};`));
console.log(
  `Prepared ${EDGE_FILES.length} edge modules and ${Object.keys(assets).length} site assets; no secrets included.`,
);
console.log('Deploy both: the edge function (supabase functions deploy siris-manager) and the Sites worker.');
