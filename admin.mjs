import { createFormulaSync } from './formula-sync.mjs';
import pg from 'pg';
import { createLookupSync } from './lookup-sync.mjs';
import { createHash } from 'node:crypto';

const TYPES = {
  text: 'text',
  varchar: 'character varying',
  smallint: 'smallint',
  integer: 'integer',
  bigint: 'bigint',
  numeric: 'numeric',
  real: 'real',
  double: 'double precision',
  date: 'date',
  time: 'time without time zone',
  timestamp: 'timestamp with time zone',
  timestamp_local: 'timestamp without time zone',
  boolean: 'boolean',
  json: 'json',
  jsonb: 'jsonb',
  uuid: 'uuid',
  bytea: 'bytea',
};
function safeDefaultExpression(value) {
  return /^(?:now\(\)|current_timestamp|current_date|gen_random_uuid\(\))(?:\s*[+-]\s*interval\s*'\d{1,6} (?:day|days|hour|hours|minute|minutes)')?$/i.test(
    value.trim(),
  );
}
function addOptions(req) {
  const o = req.options || {};
  if (
    typeof o !== 'object' ||
    Array.isArray(o) ||
    Object.keys(o).some(
      k =>
        ![
          'nullable',
          'unique',
          'identity',
          'defaultKind',
          'defaultValue',
          'description',
          'array',
          'enumType',
          'foreignTable',
          'foreignColumn',
          'onDelete',
          'onUpdate',
        ].includes(k),
    )
  )
    throw Error('Tùy chọn cột không hợp lệ.');
  const nullable = o.nullable !== false,
    unique = o.unique === true,
    identity = o.identity === true,
    array = o.array === true,
    kind = o.defaultKind || 'none';
  if (array && (identity || kind === 'now' || kind === 'uuid'))
    throw Error('Mảng không hỗ trợ identity hoặc mặc định tự sinh.');
  if (!['none', 'literal', 'now', 'uuid', 'expression'].includes(kind)) throw Error('Giá trị mặc định không hợp lệ.');
  if (identity && (!['smallint', 'integer', 'bigint'].includes(req.newType) || kind !== 'none'))
    throw Error('Identity chỉ hỗ trợ số nguyên và không dùng cùng giá trị mặc định.');
  if (kind === 'now' && !['timestamp', 'timestamp_local', 'date'].includes(req.newType))
    throw Error('Giá trị now chỉ hỗ trợ ngày và thời gian.');
  if (kind === 'uuid' && req.newType !== 'uuid') throw Error('UUID tự sinh chỉ hỗ trợ kiểu uuid.');
  if (kind === 'literal' && (typeof o.defaultValue !== 'string' || o.defaultValue.length > 4000))
    throw Error('Giá trị mặc định không hợp lệ.');
  if (kind === 'expression' && (typeof o.defaultValue !== 'string' || !safeDefaultExpression(o.defaultValue)))
    throw Error(
      'Biểu thức chưa được hỗ trợ. Dùng now(), current_date, current_timestamp, gen_random_uuid() hoặc phép cộng/trừ thời gian đơn giản.',
    );
  if (o.description !== undefined && (typeof o.description !== 'string' || o.description.length > 1000))
    throw Error('Mô tả quá dài.');
  return { nullable, unique, identity, array, kind, value: o.defaultValue, description: o.description || '' };
}
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const ident = value => '"' + String(value).replaceAll('"', '""') + '"';
const tableRef = value => `public.${ident(value)}`;
const validName = value => typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value);
const safeError = error =>
  error?.code === '23505'
    ? 'Giá trị đã tồn tại.'
    : error?.code === '23503'
      ? 'Bản ghi liên kết không còn tồn tại hoặc đang được sử dụng.'
      : error?.code === '42501'
        ? 'Kết nối database không có đủ quyền.'
        : error?.code === '22P02'
          ? 'Dữ liệu không thể chuyển sang kiểu đã chọn.'
          : error?.code === '55P03'
            ? 'Bảng đang được sử dụng; vui lòng thử lại.'
            : error?.code === '57014'
              ? 'Thao tác vượt thời gian cho phép; vui lòng thử lại.'
              : error?.code
                ? 'Không thể thực hiện thao tác database. Kiểm tra quyền và cấu hình kết nối.'
                : error?.message || 'Không thể thực hiện thao tác.';
const METADATA_SQL = [
  `SELECT c.oid::text AS table_oid,c.relname AS table_name,a.attnum AS column_id,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS format,CASE WHEN t.typname='timestamptz' THEN 'timestamp with time zone' WHEN t.typname='timestamp' THEN 'timestamp without time zone' WHEN t.typname='int4' THEN 'integer' WHEN t.typname='int8' THEN 'bigint' WHEN t.typname='int2' THEN 'smallint' WHEN t.typname='float8' THEN 'double precision' WHEN t.typname='float4' THEN 'real' WHEN t.typname='bool' THEN 'boolean' WHEN t.typname='varchar' THEN 'character varying' ELSE t.typname END AS data_type,col_description(c.oid,a.attnum) AS description,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value,EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p' AND a.attnum=ANY(k.conkey)) AS is_primary,EXISTS(SELECT 1 FROM pg_constraint k WHERE (k.conrelid=c.oid AND a.attnum=ANY(k.conkey)) OR (k.confrelid=c.oid AND a.attnum=ANY(k.confkey))) AS has_constraint,EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND a.attnum=ANY(i.indkey)) AS has_index,EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.refobjid=c.oid AND dep.refobjsubid=a.attnum AND dep.classid='pg_rewrite'::regclass) AS has_view,EXISTS(SELECT 1 FROM pg_constraint k WHERE (k.conrelid=c.oid AND k.contype<>'p' AND a.attnum=ANY(k.conkey)) OR (k.confrelid=c.oid AND a.attnum=ANY(k.confkey))) AS has_type_constraint,EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND NOT i.indisprimary AND a.attnum=ANY(i.indkey)) AS has_type_index FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname,a.attnum`,
  `SELECT k.conname,src.relname AS source_table,dst.relname AS target_table,array_agg(sa.attname::text ORDER BY p.n) AS source_columns,array_agg(ta.attname::text ORDER BY p.n) AS target_columns FROM pg_constraint k JOIN pg_class src ON src.oid=k.conrelid JOIN pg_namespace sn ON sn.oid=src.relnamespace JOIN pg_class dst ON dst.oid=k.confrelid JOIN pg_namespace dn ON dn.oid=dst.relnamespace JOIN LATERAL generate_subscripts(k.conkey,1) p(n) ON true JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=k.conkey[p.n] JOIN pg_attribute ta ON ta.attrelid=dst.oid AND ta.attnum=k.confkey[p.n] WHERE k.contype='f' AND sn.nspname='public' AND dn.nspname='public' GROUP BY k.oid,src.relname,dst.relname`,
  `SELECT c.relname AS table_name,k.conname AS name,array_agg(a.attname::text ORDER BY p.n) AS columns FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN LATERAL generate_subscripts(k.conkey,1) p(n) ON true JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[p.n] WHERE n.nspname='public' AND k.contype='u' GROUP BY c.relname,k.oid`,
  `SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
  `SELECT c.relname AS table_name,a.attname AS column_name,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped JOIN pg_type t ON t.oid=a.atttypid JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY c.relname,a.attname`,
];
export function createAdmin(connectionString, poolOverride) {
  const pool =
    poolOverride ||
    (connectionString ? new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 }) : null);
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  async function metadata(client = pool) {
    // Pool queries run in parallel; a transaction client must run them in order.
    const rows = client === pool ? await Promise.all(METADATA_SQL.map(sql => pool.query(sql))) : [];
    if (client !== pool) for (const sql of METADATA_SQL) rows.push(await client.query(sql));
    const result = rows[0];
    const map = new Map();
    for (const r of result.rows) {
      if (!map.has(r.table_name))
        map.set(r.table_name, {
          name: `public.${r.table_name}`,
          table_oid: r.table_oid,
          columns: [],
          primary_keys: [],
          foreign_key_constraints: [],
        });
      const t = map.get(r.table_name),
        options = ['updatable'];
      if (!r.attnotnull) options.push('nullable');
      if (r.attidentity) options.push('identity');
      if (r.attgenerated) options.push('generated');
      t.columns.push({
        name: r.column_name,
        column_id: r.column_id,
        data_type: r.data_type,
        format: r.format,
        options,
        description: r.description || '',
        default_value: r.default_value,
        identity_generation: r.attidentity === 'a' ? 'ALWAYS' : r.attidentity ? 'BY DEFAULT' : undefined,
        protected: !!(r.is_primary || r.attgenerated || r.attidentity || r.has_constraint || r.has_index || r.has_view),
        delete_protected: !!(r.is_primary || r.attidentity || r.has_constraint || r.has_index || r.has_view),
        type_protected: !!(r.attgenerated || r.attidentity || r.has_type_constraint || r.has_type_index || r.has_view),
      });
      if (r.is_primary) t.primary_keys.push(r.column_name);
    }
    const refs = rows[1];
    for (const r of refs.rows) {
      const f = {
        name: r.conname,
        source_table: `public.${r.source_table}`,
        source_columns: r.source_columns,
        target_table: `public.${r.target_table}`,
        target_columns: r.target_columns,
      };
      map.get(r.source_table)?.foreign_key_constraints.push(f);
      if (r.source_table !== r.target_table) map.get(r.target_table)?.foreign_key_constraints.push(f);
    }
    const unique = rows[2];
    const indexes = rows[3];
    const enums = rows[4];
    for (const t of map.values()) {
      t.unique_constraints = [];
      t.indexes = [];
      t.relations = [];
    }
    for (const r of unique.rows) map.get(r.table_name)?.unique_constraints.push({ name: r.name, columns: r.columns });
    for (const r of indexes.rows) map.get(r.table_name)?.indexes.push({ name: r.name, definition: r.definition });
    for (const r of enums.rows) {
      const c = map.get(r.table_name)?.columns.find(x => x.name === r.column_name);
      if (c) c.enum_values = r.values;
    }
    for (const t of map.values()) {
      const outgoing = t.foreign_key_constraints.filter(f => f.source_table === t.name);
      for (const f of outgoing)
        t.relations.push({ kind: 'many-to-one', constraint: f.name, target_table: f.target_table });
      const keys = new Set(outgoing.flatMap(f => f.source_columns));
      if (
        outgoing.length === 2 &&
        t.primary_keys.length &&
        t.primary_keys.every(k => keys.has(k)) &&
        keys.size === t.primary_keys.length
      )
        t.junction = true;
    }
    return [...map.values()];
  }
  async function visibleMetadata(role = 'authenticated') {
    if (!['anon', 'authenticated'].includes(role)) throw Error('Vai trò không hợp lệ.');
    const [tables, access] = await Promise.all([
      metadata(),
      pool.query(
        `SELECT c.relname,a.attname,has_table_privilege($1,c.oid,'SELECT') AS table_read FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind IN ('r','p') AND has_schema_privilege($1,n.oid,'USAGE') AND has_column_privilege($1,c.oid,a.attnum,'SELECT')`,
        [role],
      ),
    ]);
    const permitted = new Map();
    for (const row of access.rows) {
      if (!permitted.has(row.relname)) permitted.set(row.relname, { columns: new Set(), tableRead: row.table_read });
      permitted.get(row.relname).columns.add(row.attname);
    }
    return tables
      .filter(t => permitted.has(t.name.slice(7)))
      .map(t => {
        const accessForTable = permitted.get(t.name.slice(7)),
          allowed = accessForTable.columns,
          columns = t.columns.filter(c => allowed.has(c.name)),
          allKeysVisible = t.primary_keys.every(k => allowed.has(k));
        return {
          ...t,
          columns,
          primary_keys: allKeysVisible ? t.primary_keys : [],
          unique_constraints: t.unique_constraints.filter(u => u.columns.every(c => allowed.has(c))),
          indexes: accessForTable.tableRead ? t.indexes : [],
          foreign_key_constraints: t.foreign_key_constraints.filter(f => {
            const source = permitted.get(f.source_table.slice(7)),
              target = permitted.get(f.target_table.slice(7));
            return (
              source &&
              target &&
              f.source_columns.every(c => source.columns.has(c)) &&
              f.target_columns.every(c => target.columns.has(c))
            );
          }),
          relations: t.relations.filter(r => permitted.has(r.target_table.slice(7))),
        };
      });
  }
  async function enumTypes(client = pool) {
    const r = await client.query(
      "SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' ORDER BY t.typname",
    );
    return r.rows.map(x => x.name);
  }
  async function columnType(req, client) {
    if (req.newType !== 'enum') return TYPES[req.newType];
    const enumName = req.options?.enumType;
    if (!validName(enumName) || !(await enumTypes(client)).includes(enumName)) throw Error('Kiểu enum không tồn tại.');
    return `public.${ident(enumName)}`;
  }
  function getTable(tables, n) {
    const t = tables.find(x => x.name === `public.${n}`);
    if (!t) throw Error('Không tìm thấy bảng.');
    return t;
  }
  async function previewDuplicate(req, client) {
    if (!validName(req.table) || !validName(req.column) || !validName(req.newName))
      throw Error('Tên bảng hoặc cột không hợp lệ.');
    const tables = await metadata(client),
      t = getTable(tables, req.table),
      col = t.columns.find(c => c.name === req.column);
    if (!col) throw Error('Không tìm thấy cột.');
    if (t.columns.some(c => c.name === req.newName)) throw Error('Tên cột đã tồn tại.');
    const type = col.format || col.data_type;
    if (!type || typeof type !== 'string') throw Error('Không đọc được kiểu dữ liệu của cột.');
    const count = await client.query(
        `SELECT count(*)::text AS n FROM ${tableRef(req.table)} WHERE ${ident(col.name)} IS NOT NULL`,
      ),
      affected = Number(count.rows[0].n);
    const signature = createHash('sha256')
      .update(JSON.stringify({ table: t, req, affected }))
      .digest('hex');
    return {
      signature,
      affected,
      action: 'duplicate',
      table: req.table,
      column: req.column,
      newName: req.newName,
      newType: type,
    };
  }
  async function preview(req, client = pool, ignoreLookupId = null) {
    if (req.action === 'duplicate') return previewDuplicate(req, client);
    const tables = await metadata(client),
      t = getTable(tables, req.table),
      col = t.columns.find(c => c.name === req.column);
    if (!['add', 'rename', 'type', 'delete', 'settings'].includes(req.action)) throw Error('Thao tác không hợp lệ.');
    if (req.action !== 'add' && !col) throw Error('Không tìm thấy cột.');
    if (req.action === 'add' || req.action === 'rename') {
      if (!validName(req.newName))
        throw Error('Tên cột chỉ gồm chữ, số và dấu gạch dưới, bắt đầu bằng chữ hoặc dấu gạch dưới.');
      if (t.columns.some(c => c.name === req.newName)) throw Error('Tên cột đã tồn tại.');
    }
    if (
      ['add', 'type'].includes(req.action) &&
      !TYPES[req.newType] &&
      !(req.action === 'add' && req.newType === 'enum')
    )
      throw Error('Kiểu cột không được hỗ trợ.');
    if (req.action === 'add') {
      const options = addOptions(req),
        type = await columnType(req, client),
        ref = req.options?.foreignTable;
      if (ref) {
        const target = getTable(tables, ref),
          key = target.columns.find(c => c.name === req.options?.foreignColumn);
        if (
          !key ||
          !validName(key.name) ||
          options.array ||
          req.newType === 'enum' ||
          key.data_type !==
            ({
              varchar: 'character varying',
              double: 'double precision',
              timestamp: 'timestamp with time zone',
              timestamp_local: 'timestamp without time zone',
              time: 'time without time zone',
            }[req.newType] || req.newType)
        )
          throw Error('Khóa ngoại cần cột đích cùng kiểu dữ liệu.');
        if (
          ![target.primary_keys, ...(target.unique_constraints || []).map(x => x.columns)].some(
            cols => cols.length === 1 && cols[0] === key.name,
          )
        )
          throw Error('Cột được tham chiếu cần khóa chính hoặc unique.');
        for (const action of [req.options.onDelete || 'NO ACTION', req.options.onUpdate || 'NO ACTION'])
          if (!['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].includes(action))
            throw Error('Hành động khóa ngoại không hợp lệ.');
        if ((req.options.onDelete === 'SET NULL' || req.options.onUpdate === 'SET NULL') && !options.nullable)
          throw Error('SET NULL yêu cầu cột cho phép null.');
      }
      if (options.kind === 'literal') {
        try {
          await client.query(`SELECT $1::${type}${options.array ? '[]' : ''}`, [options.value]);
        } catch {
          throw Error('Giá trị mặc định không phù hợp với kiểu cột.');
        }
      }
      if (options.kind === 'expression') {
        try {
          await client.query(`EXPLAIN SELECT (${options.value.trim()})::${type}${options.array ? '[]' : ''}`);
        } catch {
          throw Error('Biểu thức mặc định không phù hợp với kiểu cột.');
        }
      }
      if (
        (!options.nullable && !options.identity && options.kind === 'none') ||
        (options.unique && !options.identity && ['literal', 'now', 'expression'].includes(options.kind))
      ) {
        const count = await client.query(`SELECT count(*)::text AS n FROM ${tableRef(req.table)}`),
          n = Number(count.rows[0].n);
        if (!options.nullable && !options.identity && options.kind === 'none' && n > 0)
          throw Error('Bảng đã có dữ liệu; cần giá trị mặc định hoặc cho phép null.');
        if (options.unique && n > 1 && !options.identity && ['literal', 'now', 'expression'].includes(options.kind))
          throw Error('Giá trị mặc định sẽ trùng trên các bản ghi hiện có.');
      }
    }
    if (req.action === 'settings') {
      const o = req.options;
      if (
        !o ||
        typeof o !== 'object' ||
        Array.isArray(o) ||
        Object.keys(o).some(k => !['nullable', 'unique', 'defaultKind', 'defaultValue', 'description'].includes(k)) ||
        typeof o.nullable !== 'boolean' ||
        typeof o.unique !== 'boolean' ||
        !['keep', 'none', 'literal', 'expression'].includes(o.defaultKind) ||
        typeof o.description !== 'string' ||
        o.description.length > 1000
      )
        throw Error('Tùy chọn cột không hợp lệ.');
      if (col.options.includes('generated') || col.options.includes('identity'))
        throw Error('Cột tự sinh hoặc identity chưa hỗ trợ thay đổi các thuộc tính này.');
      if (t.primary_keys.includes(col.name) && o.nullable) throw Error('Khóa chính không thể để trống.');
      if (!o.nullable) {
        const r = await client.query(
          `SELECT count(*)::text AS n FROM ${tableRef(req.table)} WHERE ${ident(col.name)} IS NULL`,
        );
        if (Number(r.rows[0].n)) throw Error('Cột có giá trị trống; hãy điền trước khi tắt cho phép trống.');
      }
      const existing = t.unique_constraints.filter(x => x.columns.length === 1 && x.columns[0] === col.name);
      if (!o.unique && t.primary_keys.length === 1 && t.primary_keys[0] === col.name)
        throw Error('Không thể bỏ duy nhất khỏi khóa chính.');
      if (!o.unique && existing.length > 1) throw Error('Cột có nhiều ràng buộc duy nhất; hãy xử lý trong Supabase.');
      if (o.unique && !existing.length && !t.primary_keys.includes(col.name)) {
        const r = await client.query(
          `SELECT 1 FROM ${tableRef(req.table)} WHERE ${ident(col.name)} IS NOT NULL GROUP BY ${ident(col.name)} HAVING count(*)>1 LIMIT 1`,
        );
        if (r.rows.length) throw Error('Cột có giá trị trùng; hãy xử lý trước khi bật duy nhất.');
      }
      if (o.defaultKind === 'literal' && (typeof o.defaultValue !== 'string' || o.defaultValue.length > 4000))
        throw Error('Giá trị mặc định không hợp lệ.');
      if (
        o.defaultKind === 'expression' &&
        (typeof o.defaultValue !== 'string' || !safeDefaultExpression(o.defaultValue))
      )
        throw Error('Biểu thức chưa được hỗ trợ.');
      if (o.defaultKind === 'literal') {
        try {
          await client.query(`SELECT $1::${col.format}`, [o.defaultValue]);
        } catch {
          throw Error('Giá trị mặc định không phù hợp với kiểu cột.');
        }
      }
    }
    if (col && req.action === 'delete') {
      // A generated column owns its expression; that expression is removed
      // with the column. Every other dependent object must be handled first,
      // including auto-dependencies that DROP RESTRICT alone would remove.
      const dependencies = await client.query(
        `SELECT DISTINCT pg_describe_object(d.classid,d.objid,d.objsubid) AS description
         FROM pg_depend d
         WHERE d.refclassid='pg_class'::regclass AND d.refobjid=$1::oid AND d.refobjsubid=$2
           AND NOT (d.classid='pg_attrdef'::regclass AND d.objid IN (
             SELECT a.oid FROM pg_attrdef a WHERE a.adrelid=$1::oid AND a.adnum=$2
           ))
         ORDER BY description`,
        [t.table_oid, col.column_id],
      );
      if (dependencies.rows.length)
        throw Error(
          'Không thể xóa cột vì đang được sử dụng bởi: ' + dependencies.rows.map(d => d.description).join('; '),
        );
    }
    if (
      col &&
      ((req.action === 'type' && col.type_protected) ||
        (req.action === 'rename' && col.protected) ||
        (req.action === 'delete' && (col.delete_protected ?? col.protected)))
    )
      throw Error('Cột có chỉ mục, ràng buộc hoặc phụ thuộc; cần xử lý trong Supabase trước.');
    if (col) {
      const exists = await client.query("SELECT to_regclass('siris_admin.lookup_configs') IS NOT NULL AS present");
      if (exists.rows[0].present) {
        const saved = await client.query('SELECT config FROM siris_admin.lookup_configs');
        if (
          saved.rows.some(({ config: c }) => {
            if (
              c.id === ignoreLookupId &&
              req.action === 'rename' &&
              c.columnBound === true &&
              c.sync?.enabled &&
              c.sourceTable === req.table &&
              c.sync.columnName === col.name
            )
              return false;
            const rules = Array.isArray(c.conditions)
              ? c.conditions
              : [{ sourceColumn: c.sourceColumn, targetKey: c.targetKey }];
            return (
              (c.sourceTable === req.table &&
                ((c.sync?.enabled && c.sync.columnName === col.name) ||
                  rules.some(r => r.sourceColumn === col.name))) ||
              (c.targetTable === req.table && (c.targetField === col.name || rules.some(r => r.targetKey === col.name)))
            );
          })
        )
          throw Error('Cột đang được lookup sử dụng. Hãy xử lý lookup trước.');
      }
    }
    let affected = 0;
    if (col) {
      const count = await client.query(
        `SELECT count(*)::text AS n FROM ${tableRef(req.table)} WHERE ${ident(col.name)} IS NOT NULL`,
      );
      affected = Number(count.rows[0].n);
    }
    if (req.action === 'type') {
      try {
        await client.query(
          `SELECT count(${ident(col.name)}::${TYPES[req.newType]}) FROM ${tableRef(req.table)} WHERE ${ident(col.name)} IS NOT NULL`,
        );
      } catch {
        throw Error('Có dữ liệu không thể chuyển sang kiểu đã chọn.');
      }
    }
    const signature = createHash('sha256')
      .update(JSON.stringify({ table: t, affected, req }))
      .digest('hex');
    return {
      signature,
      affected,
      action: req.action,
      ...(req.action === 'delete'
        ? {
            dependenciesChecked: true,
            generatedExpression: col.options.includes('generated') ? col.default_value : null,
          }
        : {}),
      table: req.table,
      column: req.column,
      newName: req.newName,
      newType: req.newType,
    };
  }
  async function apply(req, signature) {
    return transaction(async client => {
      // ACCESS EXCLUSIVE chặn cả lệnh đọc xếp hàng phía sau; không chờ vô hạn
      // khi bảng đang bận.
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      const p = await preview(req, client);
      if (p.signature !== signature) throw Error('Cấu trúc hoặc dữ liệu đã thay đổi. Hãy xem lại trước khi áp dụng.');
      await client.query(`LOCK TABLE ${tableRef(req.table)} IN ACCESS EXCLUSIVE MODE`);
      const checked = await preview(req, client);
      if (checked.signature !== signature)
        throw Error('Cấu trúc hoặc dữ liệu đã thay đổi. Hãy xem lại trước khi áp dụng.');
      if (req.action === 'duplicate') {
        const t = getTable(await metadata(client), req.table),
          col = t.columns.find(c => c.name === req.column);
        await client.query(
          `ALTER TABLE ${tableRef(req.table)} ADD COLUMN ${ident(req.newName)} ${col.format || col.data_type}`,
        );
        await client.query(
          `UPDATE ${tableRef(req.table)} SET ${ident(req.newName)} = ${ident(req.column)} WHERE ${ident(req.column)} IS NOT NULL`,
        );
        if (col.description)
          await client.query(
            `COMMENT ON COLUMN ${tableRef(req.table)}.${ident(req.newName)} IS ${literal(col.description)}`,
          );
        await client.query("NOTIFY pgrst, 'reload schema'");
        return { ok: true, column: req.newName };
      }
      if (req.action === 'settings') {
        const o = req.options,
          t = getTable(await metadata(client), req.table),
          c = t.columns.find(x => x.name === req.column),
          column = ident(req.column),
          current = t.unique_constraints.filter(x => x.columns.length === 1 && x.columns[0] === req.column);
        if (o.nullable !== c.options.includes('nullable'))
          await client.query(
            `ALTER TABLE ${tableRef(req.table)} ALTER COLUMN ${column} ${o.nullable ? 'DROP' : 'SET'} NOT NULL`,
          );
        if (o.unique && !current.length && !t.primary_keys.includes(req.column))
          await client.query(`ALTER TABLE ${tableRef(req.table)} ADD UNIQUE (${column})`);
        if (!o.unique && current.length)
          await client.query(`ALTER TABLE ${tableRef(req.table)} DROP CONSTRAINT ${ident(current[0].name)} RESTRICT`);
        if (o.defaultKind !== 'keep') {
          const def =
            o.defaultKind === 'none'
              ? 'DROP DEFAULT'
              : o.defaultKind === 'literal'
                ? `SET DEFAULT ${literal(o.defaultValue)}::${c.format}`
                : `SET DEFAULT ${o.defaultValue.trim()}`;
          await client.query(`ALTER TABLE ${tableRef(req.table)} ALTER COLUMN ${column} ${def}`);
        }
        await client.query(
          `COMMENT ON COLUMN ${tableRef(req.table)}.${column} IS ${o.description ? literal(o.description) : 'NULL'}`,
        );
        await client.query("NOTIFY pgrst, 'reload schema'");
        return { ok: true };
      }
      let sql;
      if (req.action === 'add') {
        const o = addOptions(req),
          type = await columnType(req, client),
          def =
            o.kind === 'literal'
              ? ` DEFAULT ${literal(o.value)}::${type}${o.array ? '[]' : ''}`
              : o.kind === 'now'
                ? ' DEFAULT now()'
                : o.kind === 'uuid'
                  ? ' DEFAULT gen_random_uuid()'
                  : o.kind === 'expression'
                    ? ` DEFAULT ${o.value.trim()}`
                    : '';
        sql = `ADD COLUMN ${ident(req.newName)} ${type}${o.array ? '[]' : ''}${o.identity ? ' GENERATED BY DEFAULT AS IDENTITY' : def}${!o.nullable && !o.identity ? ' NOT NULL' : ''}${o.unique ? ' UNIQUE' : ''}${req.options?.foreignTable ? ` REFERENCES ${tableRef(req.options.foreignTable)} (${ident(req.options.foreignColumn)}) ON DELETE ${req.options.onDelete || 'NO ACTION'} ON UPDATE ${req.options.onUpdate || 'NO ACTION'}` : ''}`;
      }
      if (req.action === 'rename') sql = `RENAME COLUMN ${ident(req.column)} TO ${ident(req.newName)}`;
      if (req.action === 'type')
        sql = `ALTER COLUMN ${ident(req.column)} TYPE ${TYPES[req.newType]} USING ${ident(req.column)}::${TYPES[req.newType]}`;
      if (req.action === 'delete') sql = `DROP COLUMN ${ident(req.column)} RESTRICT`;
      await client.query(`ALTER TABLE ${tableRef(req.table)} ${sql}`);
      if (req.action === 'add' && addOptions(req).description)
        await client.query(
          `COMMENT ON COLUMN ${tableRef(req.table)}.${ident(req.newName)} IS ${literal(addOptions(req).description)}`,
        );
      await client.query("NOTIFY pgrst, 'reload schema'");
      return { ok: true };
    });
  }
  return {
    formulaSync: createFormulaSync(pool, metadata),
    lookupSync: createLookupSync(pool, metadata, (request, client, id) => preview(request, client, id)),
    enabled: !!pool,
    metadata,
    visibleMetadata,
    enumTypes,
    preview,
    apply,
    close: () => pool?.end(),
  };
}
export { safeError };
