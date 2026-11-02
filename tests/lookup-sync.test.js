import { describe, expect, it } from 'vitest';
import { validateLookupSync, lookupSyncSQL, dropLookupSyncSQL, createLookupSync } from '../lookup-sync.mjs';

const col = (name, data_type, extra = {}) => ({ name, data_type, format: data_type, options: ['updatable', 'nullable'], ...extra });
const tables = () => [{ name: 'public.rooms', primary_keys: ['id'], columns: [col('id','uuid'), col('branchid','uuid'), col('name','text'), col('price','numeric'),col('count','bigint')] }, { name: 'public.branches', primary_keys: ['id'], columns: [col('id','uuid'), col('name','text'),col('price','numeric')] }];
const config = { id: 'lookup-test', label: 'Tên chi nhánh', sourceTable: 'rooms', targetTable: 'branches', targetField: 'name', conditions: [{sourceColumn:'branchid',targetKey:'id'}], mode: 'all', display: 'value', sync: {enabled:true,columnName:'name'} };
const enabled = {...config,sync:{...config.sync,token:'0123456789abcdef01234567'}};

describe('lookup ghi vào cột có sẵn', () => {
 it('kiểm tra kiểu chính xác, bao gồm precision, mảng và enum', () => {
  expect(validateLookupSync(config,tables()).dataType).toBe('text');
  expect(() => validateLookupSync({...config,sync:{enabled:true,columnName:'price'}},tables())).toThrow('Không khớp kiểu');
  for (const [left,right] of [['numeric(10,2)','numeric(12,2)'],['text[]','text'],['status_a','status_b']]) {
   const meta = tables();meta[0].columns[2].format=left;meta[1].columns[1].format=right;
   expect(() => validateLookupSync(config,meta)).toThrow('Không khớp kiểu');
  }
  expect(validateLookupSync({...config,display:'count',sync:{enabled:true,columnName:'count'}},tables()).dataType).toBe('bigint');
 });
 it('chặn khóa chính, cột tự sinh, cột không cho phép trống và tự tham chiếu', () => {
  expect(() => validateLookupSync({...config,sync:{enabled:true,columnName:'id'}},tables())).toThrow('khóa chính');
  for (const extra of [{protected:true},{options:['generated']},{options:['updatable']}]) {
   const meta=tables();Object.assign(meta[0].columns[2],extra);expect(() => validateLookupSync(config,meta)).toThrow();
  }
  expect(() => validateLookupSync({...config,conditions:[{sourceColumn:'name',targetKey:'name'}]},tables())).toThrow('chính lookup');
 });
 it('chặn một cột có nhiều nguồn đồng bộ và vòng giữa các bảng', () => {
  expect(() => validateLookupSync(config,tables(),[{...enabled,id:'other'}])).toThrow('lookup khác');
  expect(() => validateLookupSync(config,tables(),[{...enabled,id:'reverse',sourceTable:'branches',targetTable:'rooms'}])).toThrow('vòng');
 });
 it('đồng bộ insert/update/delete bằng trigger invoker, không tạo cột và không tự đổi kiểu', () => {
  const sql=lookupSyncSQL(enabled).join('\n');
  expect(sql).toContain('BEFORE INSERT OR UPDATE OF "branchid", "name"');
  expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE');
  expect(sql).toContain('SECURITY INVOKER SET search_path = pg_catalog');
  expect(sql).toContain('IS DISTINCT FROM');
  expect(sql).toContain('END; $sync$');
  expect(sql).toContain('AFTER TRUNCATE');
  expect(sql).toContain('pg_catalog.to_jsonb');
  expect(sql).not.toMatch(/ADD COLUMN|ALTER COLUMN|SECURITY DEFINER|LIMIT 1/);
  expect(dropLookupSyncSQL(enabled).join('\n')).not.toContain('DROP COLUMN');
 });
});

function harness(saved = []) {
 const calls=[];let configs=structuredClone(saved);
 const client={release(){calls.push({sql:'RELEASE'})},async query(sql,args){
  calls.push({sql,args});
  if(sql.includes('to_regclass'))return {rows:[{present:true}]};
  if(sql.startsWith('SELECT config'))return {rows:configs.map(config=>({config}))};
  if(sql.startsWith('SELECT count'))return {rows:[{affected:'2'}]};
  if(sql.startsWith('INSERT INTO siris_admin.lookup_configs'))configs=[JSON.parse(args[3])];
  if(sql.startsWith('DELETE FROM siris_admin.lookup_configs'))configs=configs.filter(config=>config.id!==args[0]);
  return {rows:[]};
 }};
 const pool={query:client.query,connect:async()=>client};
 return {calls,service:createLookupSync(pool,async()=>tables(),async()=>{}),get saved(){return configs}};
}
describe('transaction khi bật/tắt lookup',()=>{
 it('lưu cấu hình cùng trigger và dữ liệu trong một transaction',async()=>{
  const h=harness(),preview=await h.service.preview(config);
  await h.service.save(config,preview.signature);
  expect(h.calls.some(c=>c.sql.startsWith('CREATE TRIGGER'))).toBe(true);
  expect(h.calls.some(c=>c.sql==='COMMIT')).toBe(true);
  expect(h.saved[0].sync.enabled).toBe(true);
 });
 it('tắt toggle gỡ trigger, để trống cột và giữ tên cột trong cấu hình',async()=>{
  const h=harness([enabled]),off={...config,sync:{enabled:false,columnName:'name'}},p=await h.service.preview(off);
  expect(p.clearing).toBe(true);expect(p.affected).toBe(2);
  await h.service.save(off,p.signature);
  const sql=h.calls.map(c=>c.sql);
  expect(sql).toContain('UPDATE public."rooms" SET "name" = NULL WHERE "name" IS NOT NULL');
  expect(sql.lastIndexOf('COMMIT')).toBeGreaterThan(sql.findIndex(q=>q.startsWith('INSERT INTO')));
  expect(h.saved[0].sync).toEqual({enabled:false,columnName:'name'});
 });
 it('xóa cấu hình lookup gắn vào cột khi tắt, cùng transaction với trigger và dữ liệu',async()=>{
  const bound={...enabled,columnBound:true},h=harness([bound]),off={...bound,sync:{enabled:false,columnName:'name'}},p=await h.service.preview(off);
  expect(await h.service.save(off,p.signature)).toBeNull();expect(h.saved).toEqual([]);
  expect(h.calls.some(c=>c.sql.startsWith('DROP TRIGGER'))).toBe(true);
  expect(h.calls.some(c=>c.sql.startsWith('DELETE FROM siris_admin.lookup_configs'))).toBe(true);
  expect(h.calls.at(-2).sql).toBe('COMMIT');
 });
 it('dọn lookup gắn cột đã tắt mà không xóa lookup ảo',async()=>{
  const stale={...enabled,id:'stale',columnBound:true,sync:{enabled:false,columnName:'name'}},virtual={...enabled,id:'virtual',columnBound:false,sync:{enabled:false,columnName:'name'}},h=harness([stale,virtual]);
  expect(await h.service.cleanupDisabled()).toBe(1);expect(h.saved).toEqual([virtual]);
 });
 it('đổi tên cột lookup trong transaction và tái tạo trigger với tên mới',async()=>{
  const h=harness([{...enabled,columnBound:true}]);
  const updated=await h.service.renameColumn({table:'rooms',column:'name',newName:'branch_name',id:enabled.id});
  expect(updated.sync.columnName).toBe('branch_name');expect(h.saved[0].sync.columnName).toBe('branch_name');
  const sql=h.calls.map(c=>c.sql);expect(sql).toContain('ALTER TABLE public."rooms" RENAME COLUMN "name" TO "branch_name"');
  expect(sql.some(s=>s.startsWith('DROP TRIGGER'))).toBe(true);expect(sql.some(s=>s.startsWith('CREATE TRIGGER'))).toBe(true);expect(sql).toContain('COMMIT');
 });
 it('rollback khi không thể tái tạo trigger sau đổi tên',async()=>{
  const calls=[];const client={release(){},async query(sql){calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{present:true}]};if(sql.startsWith('SELECT config'))return {rows:[{config:{...enabled,columnBound:true}}]};if(sql.startsWith('CREATE TRIGGER'))throw Error('Lỗi trigger');return {rows:[]}}};
  const service=createLookupSync({query:client.query,connect:async()=>client},async()=>tables(),async()=>{});
  await expect(service.renameColumn({table:'rooms',column:'name',newName:'branch_name',id:enabled.id})).rejects.toThrow('Lỗi trigger');expect(calls).toContain('ROLLBACK');expect(calls).not.toContain('COMMIT');
 });
 it('preview lỗi khác kiểu và signature cũ không sửa dữ liệu',async()=>{
  const h=harness();await expect(h.service.preview({...config,sync:{enabled:true,columnName:'price'}})).rejects.toThrow('Không khớp kiểu');
  await expect(h.service.save(config,'stale')).rejects.toThrow('đã thay đổi');
  expect(h.calls.some(c=>c.sql==='ROLLBACK')).toBe(true);
  expect(h.calls.some(c=>/^(CREATE|UPDATE|INSERT|DROP)/.test(c.sql))).toBe(false);
 });
 it('lỗi khi đồng bộ rollback cả cấu hình và trigger',async()=>{
  const calls=[];const client={release(){},async query(sql){calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{present:true}]};if(sql.startsWith('SELECT config'))return {rows:[]};if(sql.startsWith('SELECT count'))return {rows:[{affected:'2'}]};if(sql.startsWith('CREATE TRIGGER'))throw Object.assign(Error('private detail'),{code:'42501'});return {rows:[]}}};
  const service=createLookupSync({query:client.query,connect:async()=>client},async()=>tables()),p=await service.preview(config);calls.length=0;
  await expect(service.save(config,p.signature)).rejects.toThrow('không có quyền');
  expect(calls).toContain('ROLLBACK');expect(calls).not.toContain('COMMIT');expect(calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
 });
});
