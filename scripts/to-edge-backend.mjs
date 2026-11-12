function replaceRequired(source, pattern, replacement) {
 if (typeof pattern === 'string' ? !source.includes(pattern) : !pattern.test(source)) throw new Error(`Edge conversion missing pattern: ${pattern}`);
 return source.replace(pattern, replacement);
}
export function toEdgeBackend(source) {
 let server=source;
server=replaceRequired(server,"import http from 'node:http';", "import process from 'node:process';\nimport {Buffer} from 'node:buffer';");
server=replaceRequired(server,/^function envFile.*\n/m,'');
server=replaceRequired(server,"import { existsSync, readFileSync } from 'node:fs';","import { existsSync } from 'node:fs';");
server=replaceRequired(server,"import { randomBytes } from 'node:crypto';\n",'');
server=replaceRequired(server,"const env={...envFile(path.join(root,'.env.local')),...process.env};", "const env={...Deno.env.toObject(),SUPABASE_KEY:Deno.env.get('SUPABASE_ANON_KEY')};");
server=replaceRequired(server,"const csrf=randomBytes(24).toString('hex');", "const csrf='siris-sites-private';");
server=replaceRequired(server,"let tables=JSON.parse(await readFile(path.join(root,'schema.json'),'utf8'));", "let tables=structuredClone(schema);");
server=replaceRequired(server,"import pg from 'pg';","import pg from 'pg';\nimport schema from './schema.json' with {type:'json'};");
server=replaceRequired(server,"const port=Number(process.env.PORT||4173);","const port=4173;");
server=replaceRequired(server,'const server=http.createServer(async(req,res)=>{','export const handler=async(req,res)=>{');
server=replaceRequired(server,"if(u.pathname.startsWith('/api/')){const allowedOrigins","if(u.pathname.startsWith('/api/')){if(admin.enabled)tables=(await cachedMetadata()).tables;const allowedOrigins");
const tail=server.indexOf("server.listen(port,");if(tail<0)throw Error('Server entrypoint changed');server=server.slice(0,tail);
server=replaceRequired(server,/\}\);\s*$/, '};\n');
 return server;
}
