import {describe,it,expect} from 'vitest';
import {verify,payload,hash} from '../supabase/functions/siris-manager/auth.mjs';
describe('private Sites bridge',()=>{
 it('requires a valid signature bound to path, method and body',async()=>{
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const bytes=new TextEncoder().encode('{"a":1}'),time=String(Date.now()),nonce=crypto.randomUUID(),path='/functions/v1/siris-manager/api/table/rooms';
  const signature=await crypto.subtle.sign('Ed25519',keys.privateKey,payload('POST',path,time,nonce,await hash(bytes)));
  const headers={'x-siris-time':time,'x-siris-nonce':nonce,'x-siris-signature':Buffer.from(signature).toString('base64')};
  expect(await verify(new Request('https://example.com'+path,{method:'POST',headers}),bytes,keys.publicKey)).toBe(true);
  expect(await verify(new Request('https://example.com'+path,{method:'GET',headers}),bytes,keys.publicKey)).toBe(false);
  expect(await verify(new Request('https://example.com'+path+'/other',{method:'POST',headers}),bytes,keys.publicKey)).toBe(false);
  expect(await verify(new Request('https://example.com'+path,{method:'POST',headers}),new Uint8Array(),keys.publicKey)).toBe(false);
  expect(await verify(new Request('https://example.com'+path,{method:'POST',headers:{...headers,'x-siris-time':'0'}}),bytes,keys.publicKey)).toBe(false);
  expect(await verify(new Request('https://example.com'+path),bytes,keys.publicKey)).toBe(false);
 });
});

describe('Sites proxy',()=>{
 it('keeps the private signing key on the server and refuses cross-origin writes',async()=>{
  const proxy=(await import('../chatgpt-site/worker/proxy.js')).default;
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const env={SIRIS_BRIDGE_PRIVATE_KEY:Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64'),SIRIS_EDGE_URL:'https://example.com/functions/v1/siris-manager'};
  const page=await proxy.fetch(new Request('https://private.chatgpt.site/'),env);expect(page.status).toBe(200);expect(await page.text()).not.toContain(env.SIRIS_BRIDGE_PRIVATE_KEY);
  const denied=await proxy.fetch(new Request('https://private.chatgpt.site/api/table/rooms',{method:'POST',headers:{origin:'https://evil.example'}}),env);expect(denied.status).toBe(403);
  const original=globalThis.fetch;let signed=false;
  globalThis.fetch=async(url,options)=>{expect(options.redirect).toBe('manual');const req=new Request(url,options);signed=await verify(req,new Uint8Array(await req.arrayBuffer()),keys.publicKey);return Response.json({rows:[]})};
  try{const result=await proxy.fetch(new Request('https://private.chatgpt.site/api/table/rooms',{method:'POST',headers:{origin:'https://private.chatgpt.site'},body:'{}'}),env);expect(result.status).toBe(200);expect(signed).toBe(true)}finally{globalThis.fetch=original}
 });
});
