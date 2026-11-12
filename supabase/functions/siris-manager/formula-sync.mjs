import { createHash } from 'node:crypto';
import { parseFormula, formulaSQL } from './formula-parser.mjs';
import { createLookupStore } from './lookup-store.mjs';

const valid = s => typeof s === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,62}$/.test(s);
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const numeric = c => /^(smallint|integer|bigint|numeric|decimal|real|double precision)$/.test(c.data_type);
const tableRef = t => 'public.' + quote(t);
const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const triggerName = table => 'formula_' + createHash('sha256').update(table).digest('hex').slice(0, 24);

export function checkFormulas(table, configs, lookups = []) {
  const ordered = [],
    visiting = new Set(),
    done = new Set(),
    parsed = new Map();
  const active = configs.filter(c => c.enabled),
    targets = new Map(active.map(c => [c.column, c]));
  if (targets.size !== active.length) throw Error('Cột đã có formula khác.');
  for (const config of active) {
    const column = table.columns.find(c => c.name === config.column);
    if (!column || !valid(config.column) || !numeric(column)) throw Error('Cột formula phải là cột số.');
    if (
      column.protected ||
      table.primary_keys.includes(column.name) ||
      column.options.some(x => ['generated', 'identity'].includes(x))
    )
      throw Error('Không thể dùng formula trên cột khóa, tự sinh hoặc có phụ thuộc.');
    if (!column.options.includes('nullable')) throw Error('Cột formula cần cho phép trống.');
    const tree = parseFormula(config.expression, table.columns);
    if (tree.columns.includes(config.column)) throw Error('Formula không thể tham chiếu chính nó.');
    for (const lookup of lookups.filter(x => x.sync?.enabled)) {
      if (
        lookup.sourceTable === config.table &&
        (lookup.sync.columnName === config.column ||
          tree.columns.includes(lookup.sync.columnName) ||
          lookup.conditions?.some(r => r.sourceColumn === config.column))
      )
        throw Error('Formula xung đột với lookup đang đồng bộ.');
      if (
        lookup.targetTable === config.table &&
        (lookup.targetField === config.column || lookup.conditions?.some(r => r.targetKey === config.column))
      )
        throw Error('Cột này đang được lookup sử dụng.');
    }
    parsed.set(config.column, tree);
  }
  function visit(column) {
    if (visiting.has(column)) throw Error('Formula có vòng phụ thuộc.');
    if (done.has(column)) return;
    visiting.add(column);
    for (const ref of parsed.get(column).columns) if (targets.has(ref)) visit(ref);
    visiting.delete(column);
    done.add(column);
    ordered.push({ config: targets.get(column), ...parsed.get(column) });
  }
  for (const c of active) visit(c.column);
  return ordered;
}
export function formulaTriggerSQL(table, formulas) {
  const n = quote(triggerName(table));
  const statements = [
    `DROP TRIGGER IF EXISTS ${n} ON ${tableRef(table)}`,
    `DROP FUNCTION IF EXISTS siris_admin.${n}()`,
  ];
  if (!formulas.length) return statements;
  const body = formulas.map(f => `NEW.${quote(f.config.column)} := ${formulaSQL(f.ast, 'NEW')};`).join(' ');
  statements.push(
    `CREATE FUNCTION siris_admin.${n}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $formula$ BEGIN ${body} RETURN NEW; END; $formula$`,
    `REVOKE ALL ON FUNCTION siris_admin.${n}() FROM PUBLIC`,
    `CREATE TRIGGER ${n} BEFORE INSERT OR UPDATE ON ${tableRef(table)} FOR EACH ROW EXECUTE FUNCTION siris_admin.${n}()`,
    `UPDATE ${tableRef(table)} SET ${quote(formulas[0].config.column)} = ${quote(formulas[0].config.column)}`,
  );
  return statements;
}
export function createFormulaSync(pool, metadata) {
  async function available(client = pool) {
    if (!client) return false;
    return (await client.query("SELECT to_regclass('siris_admin.formula_configs') IS NOT NULL AS present")).rows[0]
      .present;
  }
  async function list(client = pool) {
    if (!(await available(client))) return [];
    return (
      await client.query('SELECT config FROM siris_admin.formula_configs ORDER BY source_table, column_name')
    ).rows.map(r => r.config);
  }
  async function save(config) {
    if (!pool) throw Error('Cần kết nối PostgreSQL để dùng formula.');
    if (
      !config ||
      !valid(config.table) ||
      !valid(config.column) ||
      typeof config.enabled !== 'boolean' ||
      typeof config.expression !== 'string' ||
      config.expression.length > 2000
    )
      throw Error('Cấu hình formula không hợp lệ.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('siris_lookup_config', 0))");
      const schemaExists = (await client.query("SELECT to_regnamespace('siris_admin') IS NOT NULL AS present")).rows[0]
        .present;
      if (!schemaExists) {
        await client.query('CREATE SCHEMA siris_admin');
        await client.query('REVOKE ALL ON SCHEMA siris_admin FROM PUBLIC, anon, authenticated');
      }
      await client.query(
        'CREATE TABLE IF NOT EXISTS siris_admin.formula_configs (source_table text NOT NULL, column_name text NOT NULL, config jsonb NOT NULL, PRIMARY KEY(source_table,column_name))',
      );
      await client.query('REVOKE ALL ON siris_admin.formula_configs FROM PUBLIC, anon, authenticated');
      await client.query(`LOCK TABLE ${tableRef(config.table)} IN SHARE ROW EXCLUSIVE MODE`);
      const tables = await metadata(client),
        table = tables.find(t => t.name === `public.${config.table}`);
      if (!table) throw Error('Không tìm thấy bảng.');
      const saved = await list(client),
        old = saved.find(c => c.table === config.table && c.column === config.column);
      if (!config.enabled && !old?.enabled) throw Error('Formula chưa được bật.');
      const clean = {
        table: config.table,
        column: config.column,
        expression: config.expression,
        enabled: config.enabled,
      };
      const all = [...saved.filter(c => !(c.table === config.table && c.column === config.column)), clean];
      const lookupStore = createLookupStore(client),
        lookups = (await lookupStore.available()) ? await lookupStore.list() : [];
      const formulas = checkFormulas(
        table,
        all.filter(c => c.table === config.table),
        lookups,
      );
      for (const sql of formulaTriggerSQL(config.table, formulas)) await client.query(sql);
      if (config.enabled)
        await client.query(
          'INSERT INTO siris_admin.formula_configs(source_table,column_name,config) VALUES($1,$2,$3::jsonb) ON CONFLICT(source_table,column_name) DO UPDATE SET config=excluded.config',
          [config.table, config.column, JSON.stringify(clean)],
        );
      else
        await client.query('DELETE FROM siris_admin.formula_configs WHERE source_table=$1 AND column_name=$2', [
          config.table,
          config.column,
        ]);
      await client.query('COMMIT');
      return config.enabled ? clean : null;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      if (error.code === '22012') throw Error('Không thể lưu: công thức chia cho 0.');
      if (error.code === '22003') throw Error('Kết quả vượt giới hạn kiểu dữ liệu của cột.');
      if (error.code === '42501') throw Error('Kết nối không có quyền lưu formula.');
      if (error.code) throw Error('Không thể lưu formula; thay đổi đã được hoàn tác.');
      throw error;
    } finally {
      client.release();
    }
  }
  return { available, list, save, signature };
}
