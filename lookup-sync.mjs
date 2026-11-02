import { parseFormula } from './formula-parser.mjs';
import { createFormulaSync } from './formula-sync.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { createLookupStore } from './lookup-store.mjs';

const valid = value => typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const ref = table => `public.${quote(table)}`;
const type = column => column.format || column.data_type;
const family = column => /^(smallint|integer|bigint|numeric|decimal|real|double precision)$/.test(column.data_type) ? 'number' : /^(text|character varying|character|varchar)$/.test(column.data_type) ? 'text' : column.data_type;

export function validateLookupSync(config, tables, saved = []) {
  if (!config || !valid(config.sourceTable) || !valid(config.targetTable) || !valid(config.sync?.columnName)) throw Error('Chọn cột Supabase để đồng bộ.');
  if (config.sourceTable === config.targetTable) throw Error('Không thể đồng bộ lookup trong cùng bảng.');
  const source = tables.find(t => t.name === `public.${config.sourceTable}`);
  const target = tables.find(t => t.name === `public.${config.targetTable}`);
  if (!source?.primary_keys?.length || !target?.primary_keys?.length) throw Error('Hai bảng cần có khóa chính.');
  const column = source.columns.find(c => c.name === config.sync.columnName);
  const field = target.columns.find(c => c.name === config.targetField);
  if (!column || !field || !valid(field.name)) throw Error('Cột đã chọn không còn tồn tại.');
  if (column.protected || source.primary_keys.includes(column.name) || column.options?.some(o => ['identity', 'generated'].includes(o))) throw Error('Không thể đồng bộ vào cột khóa chính, tự sinh hoặc có phụ thuộc.');
  if (!column.options?.includes('nullable')) throw Error('Cột nhận lookup cần cho phép null khi không có bản ghi khớp.');
  const outputType = config.display === 'count' ? 'bigint' : type(field);
  if (type(column) !== outputType) throw Error(`Không khớp kiểu dữ liệu: lookup trả về ${outputType}, cột ${column.name} là ${type(column)}.`);
  if (!['value', 'count'].includes(config.display || 'value') || !['all', 'any'].includes(config.mode || 'all')) throw Error('Cách hiển thị hoặc kết hợp lookup không hợp lệ.');
  if (!Array.isArray(config.conditions) || !config.conditions.length || config.conditions.length > 10) throw Error('Lookup cần từ 1 đến 10 điều kiện.');
  for (const rule of config.conditions) {
    const left = source.columns.find(c => c.name === rule.sourceColumn), right = target.columns.find(c => c.name === rule.targetKey);
    if (!left || !right || !valid(left.name) || !valid(right.name) || family(left) !== family(right) || /json|array|bytea/.test(left.data_type) || left.data_type.startsWith('_')) throw Error('Các cột đối chiếu cần cùng kiểu dữ liệu phù hợp.');
    if (left.name === column.name) throw Error('Cột nhận lookup không thể là điều kiện của chính lookup đó.');
  }
  const others = saved.filter(c => c.id !== config.id && c.sync?.enabled);
  if (others.some(c => c.sourceTable === config.sourceTable && (config.conditions.some(r => r.sourceColumn === c.sync.columnName) || c.conditions.some(r => r.sourceColumn === column.name)))) throw Error('Không thể dùng cột đồng bộ khác làm điều kiện trong cùng bảng.');
  if (others.some(c => c.sourceTable === config.sourceTable && c.sync.columnName === column.name)) throw Error('Cột này đang được lookup khác đồng bộ.');
  // Acyclic table dependencies also prevent indirect trigger recursion.
  const edges = [...others, config], visiting = new Set(), visited = new Set();
  function visit(table) {
    if (visiting.has(table)) throw Error('Liên kết lookup tạo vòng đồng bộ giữa các bảng.');
    if (visited.has(table)) return;
    visiting.add(table);
    for (const edge of edges.filter(c => c.sourceTable === table)) visit(edge.targetTable);
    visiting.delete(table); visited.add(table);
  }
  for (const edge of edges) visit(edge.sourceTable);
  return { ...config, sync: { enabled: true, columnName: column.name }, dataType: outputType };
}

function match(config, sourceAlias, targetAlias) {
  return '(' + config.conditions.map(c => `${targetAlias}.${quote(c.targetKey)} = ${sourceAlias}.${quote(c.sourceColumn)}`).join(config.mode === 'any' ? ' OR ' : ' AND ') + ')';
}
function expression(config, alias) {
  return `(SELECT ${config.display === 'count' ? 'count(*)' : 't.' + quote(config.targetField)} FROM ${ref(config.targetTable)} t WHERE ${match(config, alias, 't')})`;
}
function names(config) {
  if (!/^[a-f0-9]{24}$/.test(config.sync?.token || '')) throw Error('Mã đồng bộ không hợp lệ.');
  return { row: quote('sync_row_' + config.sync.token), refresh: quote('sync_refresh_' + config.sync.token), truncate: quote('sync_truncate_' + config.sync.token) };
}
export function lookupSyncSQL(config) {
  const n = names(config), column = quote(config.sync.columnName), source = ref(config.sourceTable), target = ref(config.targetTable);
  const lock = `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${config.sync.token}', 0));`;
  const fields = [...new Set([...config.conditions.map(c => c.sourceColumn), config.sync.columnName])].map(quote).join(', ');
  const update = alias => `UPDATE ${source} s SET ${column} = ${expression(config, 's')} WHERE ${match(config, 's', alias)} AND pg_catalog.to_jsonb(s.${column}) IS DISTINCT FROM pg_catalog.to_jsonb(${expression(config, 's')});`;
  return [
    `CREATE FUNCTION siris_admin.${n.row}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $sync$ BEGIN ${lock} NEW.${column} := ${expression(config, 'NEW')}; RETURN NEW; END; $sync$`,
    `REVOKE ALL ON FUNCTION siris_admin.${n.row}() FROM PUBLIC`,
    `CREATE TRIGGER ${n.row} BEFORE INSERT OR UPDATE OF ${fields} ON ${source} FOR EACH ROW EXECUTE FUNCTION siris_admin.${n.row}()`,
    `CREATE FUNCTION siris_admin.${n.refresh}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $sync$ BEGIN ${lock} IF TG_OP = 'TRUNCATE' THEN UPDATE ${source} s SET ${column} = ${expression(config, 's')} WHERE pg_catalog.to_jsonb(s.${column}) IS DISTINCT FROM pg_catalog.to_jsonb(${expression(config, 's')}); RETURN NULL; END IF; IF TG_OP <> 'INSERT' THEN ${update('OLD')} END IF; IF TG_OP <> 'DELETE' THEN ${update('NEW')} END IF; RETURN NULL; END; $sync$`,
    `REVOKE ALL ON FUNCTION siris_admin.${n.refresh}() FROM PUBLIC`,
    `CREATE TRIGGER ${n.refresh} AFTER INSERT OR UPDATE OR DELETE ON ${target} FOR EACH ROW EXECUTE FUNCTION siris_admin.${n.refresh}()`,
    `CREATE TRIGGER ${n.truncate} AFTER TRUNCATE ON ${target} FOR EACH STATEMENT EXECUTE FUNCTION siris_admin.${n.refresh}()`,
    `UPDATE ${source} s SET ${column} = ${expression(config, 's')} WHERE pg_catalog.to_jsonb(s.${column}) IS DISTINCT FROM pg_catalog.to_jsonb(${expression(config, 's')})`
  ];
}
export function dropLookupSyncSQL(config) {
  const n = names(config);
  return [`DROP TRIGGER IF EXISTS ${n.row} ON ${ref(config.sourceTable)}`, `DROP TRIGGER IF EXISTS ${n.refresh} ON ${ref(config.targetTable)}`, `DROP TRIGGER IF EXISTS ${n.truncate} ON ${ref(config.targetTable)}`, `DROP FUNCTION IF EXISTS siris_admin.${n.row}()`, `DROP FUNCTION IF EXISTS siris_admin.${n.refresh}()`];
}
const signature = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const safeError = error => {
  if (!error.code) return error;
  const messages = { '23502': 'Kết quả lookup trống nhưng cột không cho phép null.', '23505': 'Kết quả lookup vi phạm giá trị duy nhất.', '23514': 'Kết quả lookup vi phạm ràng buộc của cột.', '42501': 'Kết nối không có quyền đồng bộ các bảng đã chọn.', '55P03': 'Bảng đang được sử dụng; vui lòng thử lại.', '57014': 'Đồng bộ vượt thời gian cho phép; vui lòng thu hẹp dữ liệu.', '40P01': 'Có thay đổi đồng thời; vui lòng thử lại.' };
  if (error.code === '21000') return Error('Có nhiều bản ghi khớp một ô. Hãy thêm điều kiện hoặc dùng Đếm bản ghi.');
  return Error(messages[error.code] || 'Không thể đồng bộ lookup. Thao tác đã được hoàn tác.');
};
export function createLookupSync(pool, metadata, validateRename) {
  async function list(client) { const store = createLookupStore(client); return await store.available() ? store.list() : []; }
  async function preview(config, client = pool) {
    if (!client) throw Error('Cần kết nối PostgreSQL để đồng bộ lookup.');
    const saved = await list(client), tables = await metadata(client), old = saved.find(c => c.id === config.id);
    if (old?.sync?.enabled && old.sourceTable !== config.sourceTable) throw Error('Không thể chuyển cấu hình đồng bộ sang bảng khác.');
    if (!config.sync?.enabled) {
      if (!old?.sync?.enabled) throw Error('Lookup chưa bật đồng bộ.');
      const column = tables.find(t => t.name === `public.${old.sourceTable}`)?.columns.find(c => c.name === old.sync.columnName);
      if (!column?.options?.includes('nullable')) throw Error('Cột không còn cho phép null; cần xử lý trước khi tắt đồng bộ.');
      const result = await client.query(`SELECT count(*)::text AS affected FROM ${ref(old.sourceTable)} WHERE ${quote(old.sync.columnName)} IS NOT NULL`);
      const affected = Number(result.rows[0].affected);
      return { signature: signature({ config, tables, saved, affected }), affected, columnName: old.sync.columnName, clearing: true };
    }
    if (old?.sync?.enabled && (config.sourceTable !== old.sourceTable || config.sync.columnName !== old.sync.columnName)) throw Error('Hãy tắt đồng bộ trước khi chuyển sang cột khác.');
    const checked = validateLookupSync(config, tables, saved);
    const formulas=(await createFormulaSync(client, metadata).list()).filter(x=>x.enabled);
    if(formulas.some(f=>f.table===config.sourceTable&&(f.column===config.sync.columnName||config.conditions.some(r=>r.sourceColumn===f.column)||parseFormula(f.expression,tables.find(t=>t.name===`public.${f.table}`).columns).columns.includes(config.sync.columnName))||f.table===config.targetTable&&(f.column===config.targetField||config.conditions.some(r=>r.targetKey===f.column))))throw Error('Lookup xung đột với cột đang dùng formula.');
    const count = await client.query(`SELECT count(*)::text AS affected FROM ${ref(config.sourceTable)} s WHERE pg_catalog.to_jsonb(s.${quote(config.sync.columnName)}) IS DISTINCT FROM pg_catalog.to_jsonb(${expression(checked, 's')})`);
    const affected = Number(count.rows[0].affected);
    return { signature: signature({ config: checked, tables, saved, affected }), affected, dataType: checked.dataType, columnName: checked.sync.columnName };
  }
  async function mutate(fn) {
    if (!pool) throw Error('Cần kết nối PostgreSQL để đồng bộ lookup.');
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '30s'"); await client.query("SELECT pg_advisory_xact_lock(hashtextextended('siris_lookup_config', 0))"); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ } throw safeError(error); }
    finally { client.release(); }
  }
  async function save(config, expectedSignature) {
    return mutate(async client => {
      const store = createLookupStore(client), saved = await list(client), old = saved.find(c => c.id === config.id);
      if (!await store.available()) throw Error('Chưa thiết lập nơi lưu lookup trên Supabase.');
      const changing = config.sync?.enabled || old?.sync?.enabled;
      if (!changing) { const clean = { ...config }; if (clean.columnBound && clean.sync?.enabled === false) { await store.remove(clean.id); return null; } if(old?.sync?.columnName)clean.sync={enabled:false,columnName:old.sync.columnName};else delete clean.sync; await store.save(clean); return clean; }
      const tableNames = [...new Set([config.sourceTable, config.targetTable, ...(old?.sync?.enabled ? [old.sourceTable, old.targetTable] : [])])];
      if (tableNames.some(t => !valid(t))) throw Error('Tên bảng không hợp lệ.');
      await client.query(`LOCK TABLE ${tableNames.sort().map(ref).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
      if (changing) {
        const checked = await preview(config, client);
        if (checked.signature !== expectedSignature) throw Error('Cấu hình hoặc dữ liệu đã thay đổi. Hãy kiểm tra lại trước khi lưu.');
      }
      if (old?.sync?.enabled) {
        for (const sql of dropLookupSyncSQL(old)) await client.query(sql);
        if (!config.sync?.enabled) await client.query(`UPDATE ${ref(old.sourceTable)} SET ${quote(old.sync.columnName)} = NULL WHERE ${quote(old.sync.columnName)} IS NOT NULL`);
      }
      const clean = { ...config, sync: config.sync?.enabled ? { enabled: true, columnName: config.sync.columnName, token: randomBytes(12).toString('hex') } : { enabled: false, columnName: old?.sync?.columnName || config.sync?.columnName } };
      if (clean.sync.enabled) for (const sql of lookupSyncSQL(clean)) await client.query(sql);
      if (!clean.sync.enabled && clean.columnBound) { await store.remove(clean.id); return null; }
      await store.save(clean);
      return clean;
    });
  }
  async function renameColumn({table, column, newName, id}) {
    if (!valid(table) || !valid(column) || !valid(newName) || typeof id !== 'string') throw Error('Tên cột không hợp lệ.');
    if (!validateRename) throw Error('Không thể kiểm tra phụ thuộc của cột.');
    return mutate(async client => {
      const store=createLookupStore(client), saved=await list(client), old=saved.find(c=>c.id===id);
      if (!old?.columnBound || !old.sync?.enabled || old.sourceTable!==table || old.sync.columnName!==column) throw Error('Lookup đã thay đổi. Hãy tải lại và thử lại.');
      if (!valid(old.targetTable)) throw Error('Bảng lookup không hợp lệ.');
      await client.query(`LOCK TABLE ${[...new Set([table,old.targetTable])].sort().map(ref).join(', ')} IN ACCESS EXCLUSIVE MODE`);
      await validateRename({action:'rename',table,column,newName},client,id);
      for (const sql of dropLookupSyncSQL(old)) await client.query(sql);
      await client.query(`ALTER TABLE ${ref(table)} RENAME COLUMN ${quote(column)} TO ${quote(newName)}`);
      const updated={...old,label:old.label===column?newName:old.label,sync:{...old.sync,columnName:newName}};
      for (const sql of lookupSyncSQL(updated)) await client.query(sql);
      await store.save(updated);
      await client.query("NOTIFY pgrst, 'reload schema'");
      return updated;
    });
  }
  async function remove(id) {
    return mutate(async client => {
      const store = createLookupStore(client), old = (await list(client)).find(c => c.id === id);
      if (old?.sync?.enabled) {
        await client.query(`LOCK TABLE ${[old.sourceTable, old.targetTable].sort().map(ref).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
        for (const sql of dropLookupSyncSQL(old)) await client.query(sql);
      }
      await store.remove(id);
    });
  }
  async function cleanupDisabled() {
    if (!pool) return 0;
    return mutate(async client => {
      const store = createLookupStore(client);
      if (!await store.available()) return 0;
      const stale = (await store.list()).filter(c => c.columnBound === true && c.sync?.enabled === false);
      for (const config of stale) await store.remove(config.id);
      return stale.length;
    });
  }
  async function readPreview(config) {
    if (!pool) throw Error('Cần kết nối PostgreSQL để đồng bộ lookup.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await preview(config, client);
      await client.query('COMMIT');return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ } throw safeError(error); }
    finally { client.release(); }
  }
  return { preview: readPreview, save, remove, cleanupDisabled, renameColumn };
}
