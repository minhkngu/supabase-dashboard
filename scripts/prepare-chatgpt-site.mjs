import {toEdgeBackend} from './to-edge-backend.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
const edge='supabase/functions/siris-manager';
await mkdir(edge,{recursive:true});
let publicKey;
try{publicKey=JSON.parse(await readFile('chatgpt-site/bridge-public.json','utf8'))}catch{const pair=generateKeyPairSync('ed25519');publicKey=pair.publicKey.export({format:'jwk'});await writeFile('chatgpt-site/.env.bridge',JSON.stringify(pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64')),{mode:0o600});await writeFile('chatgpt-site/bridge-public.json',JSON.stringify(publicKey))}
for(const file of ['admin.mjs','filters.mjs','formula-parser.mjs','formula-sync.mjs','lookup-sync.mjs','lookup-store.mjs','materialized-lookup.mjs','schema.json'])await writeFile(`${edge}/${file}`,await readFile(file));
const server=toEdgeBackend(await readFile('server.mjs','utf8'));
await writeFile(`${edge}/backend.mjs`,server);
await writeFile(`${edge}/deno.json`,JSON.stringify({imports:{pg:'npm:pg@8.16.3'},nodeModulesDir:'auto'}));
await writeFile(`${edge}/bridge-public.json`,JSON.stringify(publicKey));
const assets={};for(const file of ['index.html',...(await readdir('dist/assets')).map(x=>'assets/'+x)])assets['/'+(file==='index.html'?'':file)]={body:(await readFile('dist/'+file)).toString('base64'),type:file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'};
await writeFile('chatgpt-site/worker/assets.js',`export default ${JSON.stringify(assets)};\n`);
console.log('Prepared edge modules and Site assets; no secrets included.');
const worker=(await readFile('chatgpt-site/worker/proxy.js','utf8')).replace("import assets from './assets.js';",`const assets=${JSON.stringify(assets)};`);
await writeFile('chatgpt-site/worker/index.js',worker);
