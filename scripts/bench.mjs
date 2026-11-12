import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { chromium } from '@playwright/test';

const execFile=promisify(execFileCallback);
const pgBin=process.env.SIRIS_BENCH_PG_BIN||'';
const executable=name=>pgBin?path.join(pgBin,name):name;
const work=await mkdtemp(path.join(tmpdir(),'siris-bench-'));
const dataDir=path.join(work,'postgres');
const clients=new Set();let postgresStarted=false,backend,apiServer,proxy;
const getPort=async()=>{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p};
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const schema=JSON.parse(await readFile(new URL('../schema.json',import.meta.url),'utf8'));
const dbPort=await getPort(),proxyPort=await getPort(),apiPort=await getPort(),appPort=await getPort();
const database=`postgresql://siris@127.0.0.1:${dbPort}/postgres`;
const apiDelay=Number(process.env.SIRIS_BENCH_API_MS||60),dbDelay=Number(process.env.SIRIS_BENCH_DB_MS||40);
if(!Number.isFinite(apiDelay)||apiDelay<0||apiDelay>1000||!Number.isFinite(dbDelay)||dbDelay<0||dbDelay>1000)throw Error('Độ trễ phải từ 0 đến 1000 ms');
let dbMessages=0,apiCalls=0;
try{
 try{await execFile(executable('initdb'),['-D',dataDir,'-U','siris','-A','trust','--no-locale','--encoding=UTF8']);}
 catch(error){throw Error(`Không thể khởi tạo PostgreSQL. Cài PostgreSQL 16 và đặt SIRIS_BENCH_PG_BIN tới thư mục bin. ${error.message}`)}
 await execFile(executable('pg_ctl'),['-D',dataDir,'-l',path.join(work,'postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} -k ${work}`,'-w','start']);postgresStarted=true;
 const client=new pg.Client({connectionString:database});await client.connect();
 try{
  await client.query('CREATE ROLE anon');await client.query('CREATE ROLE authenticated');
  const allowed=new Set(['uuid','text','jsonb','boolean','date','numeric','timestamp with time zone','integer','bigint','smallint']);
  for(const table of schema){
   if(!/^public\.[a-z_][a-z0-9_]*$/.test(table.name))throw Error('Tên bảng trong schema không hợp lệ');
   const defs=table.columns.map(c=>{if(!/^[a-z_][a-z0-9_]*$/i.test(c.name)||!allowed.has(c.data_type))throw Error('Cột trong schema không hợp lệ');return `${quote(c.name)} ${c.data_type}`});
   if(table.primary_keys?.length)defs.push(`PRIMARY KEY (${table.primary_keys.map(quote).join(',')})`);
   await client.query(`CREATE TABLE ${table.name.split('.').map(quote).join('.')} (${defs.join(',')})`);
  }
  await client.query('CREATE SCHEMA siris_admin');
  await client.query('CREATE TABLE siris_admin.formula_configs (source_table text NOT NULL, column_name text NOT NULL, config jsonb NOT NULL, PRIMARY KEY(source_table,column_name))');
  await client.query('CREATE TABLE siris_admin.lookup_configs (id text PRIMARY KEY, source_table text NOT NULL, label text NOT NULL, config jsonb NOT NULL)');
  await client.query('GRANT USAGE ON SCHEMA public TO anon');await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon');
 } finally{await client.end()}
 proxy=net.createServer(socket=>{
  const target=net.connect(dbPort,'127.0.0.1');clients.add(socket);clients.add(target);
  socket.on('close',()=>clients.delete(socket));target.on('close',()=>clients.delete(target));
  socket.on('error',()=>target.destroy());target.on('error',()=>socket.destroy());
  socket.pipe(target);target.on('data',chunk=>{dbMessages++;target.pause();setTimeout(()=>{if(!socket.destroyed)socket.write(chunk);target.resume()},dbDelay)});
 });proxy.listen(proxyPort,'127.0.0.1');await once(proxy,'listening');
 const allRows=Array.from({length:500},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:`Chi nhánh ${i+1}`}));
 apiServer=http.createServer(async(req,res)=>{
  apiCalls++;await delay(apiDelay);const u=new URL(req.url,'http://127.0.0.1');let rows;
  if(req.method==='GET'){const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||50);rows=allRows.slice(offset,offset+limit)}
  else{let raw='';for await(const chunk of req)raw+=chunk;rows=[{...allRows[0],...(raw?JSON.parse(raw):{})}]}
  res.writeHead(200,{'content-type':'application/json','content-range':`0-${Math.max(0,rows.length-1)}/${allRows.length}`});res.end(JSON.stringify(rows));
 });apiServer.listen(apiPort,'127.0.0.1');await once(apiServer,'listening');
 const origin=`http://127.0.0.1:${appPort}`;
 backend=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${apiPort}`,SUPABASE_KEY:'bench-only',SUPABASE_DB_URL:`postgresql://siris@127.0.0.1:${proxyPort}/postgres`,SIRIS_PERF_TIMING:'1'},stdio:['ignore','pipe','pipe']});
 let errors='';backend.stderr.on('data',chunk=>{errors+=chunk});
 await Promise.race([once(backend.stdout,'data'),once(backend,'exit').then(()=>{throw Error(`Máy chủ đo không khởi động: ${errors}`)})]);
 async function call(route,options){const res=await fetch(origin+route,options);const body=await res.json();if(!res.ok)throw Error(`${route}: ${body.error||res.status}`);return body}
 async function measure(label,fn){const db=dbMessages,api=apiCalls,start=performance.now();await fn();return {thao_tac:label,ms:Math.round(performance.now()-start),api:apiCalls-api,goi_tin_db:dbMessages-db}}
 const results=[];let meta;
 results.push(await measure('Metadata lần đầu',async()=>{meta=await call('/api/meta');if(!meta.adminAvailable)throw Error(meta.adminError)}));
 results.push(await measure('Metadata trong cache',()=>call('/api/meta')));
 await call('/api/formula-config');await call('/api/lookup-config');
 results.push(await measure('Đọc 50 dòng',()=>call('/api/table/branches?page=0')));
 const options={method:'PATCH',headers:{origin,'x-siris-token':meta.token,'content-type':'application/json'},body:JSON.stringify({key:{id:allRows[0].id},values:{name:'Đã sửa'}})};
 results.push(await measure('Lưu một ô',()=>call('/api/table/branches',options)));
 const cachedWrite=await measure('Lưu ô liên tiếp',()=>call('/api/table/branches',options));results.push(cachedWrite);
 const cachedMeta=await measure('Metadata sau khi ghi',()=>call('/api/meta'));results.push(cachedMeta);
 if(process.argv.includes('--verify-cache')){
  if(cachedWrite.goi_tin_db||cachedMeta.goi_tin_db)throw Error('Ghi dữ liệu làm mất cache cấu hình hoặc metadata');
  const check=new pg.Client({connectionString:database});await check.connect();
  try{const result=await check.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='siris' AND backend_type='client backend' AND pid<>pg_backend_pid()");if(result.rows[0].count>4)throw Error('Số kết nối PostgreSQL vượt giới hạn pool');}finally{await check.end()}
  const table=schema.find(t=>t.name==='public.items'),column=table.columns.find(c=>['integer','numeric','bigint','smallint'].includes(c.data_type)&&!table.primary_keys.includes(c.name));
  const config={table:'items',column:column.name,expression:'1',enabled:true};
  await call('/api/formula-config',{method:'POST',headers:{origin,'x-siris-token':meta.token,'content-type':'application/json'},body:JSON.stringify(config)});
  const updated=await call('/api/formula-config');
  if(!updated.items.some(item=>item.table===config.table&&item.column===config.column))throw Error('Cấu hình formula sau khi lưu không được cập nhật');
  console.log('Kiểm tra cache và pool sau hai lần ghi: đạt');
 }
 if(!process.argv.includes('--verify-cache')){
 results.push(await measure('Sửa ô và tải lại',async()=>{await call('/api/table/branches',options);await call('/api/table/branches?page=0')}));
 await delay(11000);
 results.push(await measure('Lưu ô sau 11 giây',()=>call('/api/table/branches',options)));
 results.push(await measure('Ghi 50 dòng nối tiếp',async()=>{for(let i=0;i<50;i++)await call('/api/table/branches',options)}));
 const batchOptions={...options,method:'POST',body:JSON.stringify({changes:allRows.slice(0,50).map(row=>({key:{id:row.id},values:{name:'Đã sửa'}}))})};
 results.push(await measure('Ghi lô 50 dòng',async()=>{const result=await call('/api/table/branches/batch',batchOptions);if(result.results.some(item=>!item.ok))throw Error('Có dòng ghi lô thất bại')}));
 results.push(await measure('Tổng quan 500 dòng',()=>call('/api/table/branches?page=0&limit=1000')));
 }
 const browserPath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 if(browserPath&&!process.argv.includes('--verify-cache')){
  const browser=await chromium.launch({executablePath:browserPath});
  try{
   const context=await browser.newContext(),page=await context.newPage();
   let lookupCalls=0;
   page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/lookup/'))lookupCalls++});
   const visible=()=>page.locator('td[data-bulk-column="name"]').first().waitFor();
   let start=performance.now();await page.goto(origin);await visible();
   results.push({thao_tac:'Mở ứng dụng tới khi thấy dữ liệu (lần đầu)',ms:Math.round(performance.now()-start),api:'',goi_tin_db:''});
   start=performance.now();await page.reload();await visible();
   results.push({thao_tac:'Mở ứng dụng tới khi thấy dữ liệu (đã lưu cấu trúc)',ms:Math.round(performance.now()-start),api:'',goi_tin_db:''});
   await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('#page')?.textContent==='Trang 2');
   start=performance.now();await page.locator('#prev').click();await page.waitForFunction(()=>document.querySelector('#page')?.textContent==='Trang 1');await visible();
   results.push({thao_tac:'Quay lại trang đã xem',ms:Math.round(performance.now()-start),api:'',goi_tin_db:''});
   lookupCalls=0;await page.locator('td[data-bulk-column="name"]').first().click();
   await page.locator('td.editing input').fill('Đã sửa');await page.locator('td.editing input').press('Enter');
   await delay(300);
   results.push({thao_tac:'Yêu cầu lookup sau khi sửa một ô',ms:'',api:lookupCalls,goi_tin_db:''});
  }finally{await browser.close()}
 }else if(!process.argv.includes('--verify-cache'))console.log('Bỏ qua ba phép đo trình duyệt: đặt PLAYWRIGHT_CHROMIUM_EXECUTABLE tới Chromium.');
 console.log(`Mạng giả lập: Data API ${apiDelay} ms; mỗi gói phản hồi PostgreSQL trễ ${dbDelay} ms. Gói tin không tương đương số truy vấn.`);console.table(results);
}finally{
 backend?.kill('SIGTERM');for(const socket of clients)socket.destroy();
 if(apiServer)await new Promise(resolve=>apiServer.close(resolve));if(proxy)await new Promise(resolve=>proxy.close(resolve));
 if(postgresStarted)await execFile(executable('pg_ctl'),['-D',dataDir,'-m','immediate','-w','stop']).catch(()=>{});
 await rm(work,{recursive:true,force:true});
}
