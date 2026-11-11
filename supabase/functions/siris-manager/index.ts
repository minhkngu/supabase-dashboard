import { Buffer } from 'node:buffer';
import publicKey from './bridge-public.json' with { type:'json' };
import { verify } from './auth.mjs';
const key=await crypto.subtle.importKey('jwk',publicKey,{name:'Ed25519'},false,['verify']);
Deno.serve(async request=>{
 const contentLength=Number(request.headers.get('content-length')||0);if(contentLength>1048576)return new Response('Too large',{status:413});
 const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>1048576)return new Response('Too large',{status:413});
 if(!await verify(request,bytes,key))return new Response('Unauthorized',{status:401});
 const url=new URL(request.url),path=url.pathname.includes('/api/')?url.pathname.slice(url.pathname.indexOf('/api/')):url.pathname;
 if(!path.startsWith('/api/'))return new Response('Not found',{status:404});
 try{
 const {handler}=await import('./backend.mjs');
 return await new Promise<Response>((resolve,reject)=>{
  const req={method:request.method,url:path+url.search,headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','x-siris-token':request.headers.get('x-siris-token')||''},async *[Symbol.asyncIterator](){if(bytes.length)yield Buffer.from(bytes)}};
  let status=200,headers:Record<string,string>={};
  const res={writeHead(code:number,values:Record<string,string>){status=code;headers=values},end(body?:string){resolve(new Response(body,{status,headers}))}};
  Promise.resolve(handler(req,res)).catch(reject);
 });
 }catch{return Response.json({error:'Không thể xử lý yêu cầu. Kiểm tra kết nối Supabase.'},{status:503})}
});
