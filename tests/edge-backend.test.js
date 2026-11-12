import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {toEdgeBackend} from '../scripts/to-edge-backend.mjs';

describe('edge backend conversion',()=>{
 it('converts the current server entrypoint',async()=>{
  const source=await readFile('server.mjs','utf8');
  const edge=toEdgeBackend(source);
  expect(edge).toContain('export const handler');
  expect(edge).not.toContain('http.createServer');
  expect(edge).not.toContain('server.listen');
 });
 it('rejects a missing transformation',async()=>{
  const source=await readFile('server.mjs','utf8');
  expect(()=>toEdgeBackend(source.replace("import http from 'node:http';",''))).toThrow('Edge conversion missing pattern');
 });
});
