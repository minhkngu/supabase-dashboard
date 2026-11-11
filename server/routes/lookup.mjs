import { body, response } from '../http.mjs';
import { columns, LOOKUP_STORE_MISSING } from '../context.mjs';

export async function handleLookup(ctx, req, res, u) {
  const { admin } = ctx;
  if (u.pathname === '/api/lookup-sync/rename' && req.method === 'POST') {
    const input = await body(req),
      t = ctx.meta(input.table);
    if (!columns(t).has(input.column)) throw Error('Cột không hợp lệ.');
    await ctx.assertNotUsedByFormula(input.table, input.column);
    const config = await admin.lookupSync.renameColumn(input);
    try {
      await ctx.refreshTables();
    } catch {
      response(res, 200, { config, warning: 'Đã đổi tên nhưng chưa tải được cấu trúc mới.' });
      return true;
    }
    response(res, 200, { config });
    return true;
  }
  if (u.pathname === '/api/lookup-sync/preview' && req.method === 'POST') {
    const input = await body(req);
    ctx.meta(input.sourceTable);
    ctx.meta(input.targetTable);
    response(res, 200, await admin.lookupSync.preview(input));
    return true;
  }
  if (u.pathname === '/api/lookup-config/cleanup-disabled' && req.method === 'POST') {
    response(res, 200, { removed: await admin.lookupSync.cleanupDisabled() });
    return true;
  }
  if (u.pathname === '/api/lookup-config' && req.method === 'GET') {
    try {
      response(res, 200, { available: true, items: await ctx.cachedConfig('lookup', () => ctx.lookupStore.list()) });
    } catch (error) {
      if (error.message !== LOOKUP_STORE_MISSING) throw error;
      response(res, 200, { available: false, items: [] });
    }
    return true;
  }
  if (u.pathname === '/api/lookup-config' && req.method === 'POST') {
    const input = await body(req);
    if (input.action === 'delete') {
      await admin.lookupSync.remove(input.id);
      response(res, 200, { ok: true });
      return true;
    }
    if (input.action === 'save') {
      const c = input.config;
      const source = ctx.meta(c?.sourceTable),
        target = ctx.meta(c?.targetTable);
      if (
        !columns(target).has(c?.targetField) ||
        !Array.isArray(c.conditions) ||
        !c.conditions.length ||
        c.conditions.length > 10 ||
        c.conditions.some(x => !columns(source).has(x?.sourceColumn) || !columns(target).has(x?.targetKey))
      )
        throw Error('Cấu hình lookup không hợp lệ.');
      const config = await admin.lookupSync.save(c, input.signature);
      response(res, 200, { ok: true, config });
      return true;
    }
    throw Error('Thao tác không hợp lệ.');
  }
  const lookup = u.pathname.match(/^\/api\/lookup\/([a-zA-Z0-9_]+)$/);
  if (lookup && req.method === 'POST') {
    const input = await body(req);
    response(res, 200, { rows: await lookupBatch(ctx, lookup[1], input.column, input.values, input.fields) });
    return true;
  }
  return false;
}

async function lookupBatch(ctx, tableName, column, values, fields) {
  const table = ctx.meta(tableName),
    col = columns(table).get(column);
  if (!col || /json|array|bytea/i.test(col.data_type) || col.data_type.startsWith('_'))
    throw Error('Cột đối chiếu không hợp lệ.');
  if (
    !Array.isArray(values) ||
    values.length > 50 ||
    values.some(v => !['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 500)
  )
    throw Error('Danh sách lookup không hợp lệ.');
  if (!values.length) return [];
  const quoted = [...new Set(values.map(String))]
    .map(v => '"' + v.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"')
    .join(',');
  if (
    fields !== undefined &&
    (!Array.isArray(fields) || fields.length > table.columns.length || fields.some(field => !columns(table).has(field)))
  )
    throw Error('Danh sách trường không hợp lệ.');
  const selected = fields ? [...new Set([column, ...fields])] : table.columns.map(c => c.name);
  const q = new URLSearchParams();
  q.set('select', selected.map(c => '"' + c.replaceAll('"', '\\"') + '"').join(','));
  q.set(column, `in.(${quoted})`);
  q.set('limit', '1000');
  if (table.primary_keys?.length) q.set('order', table.primary_keys.map(k => `${k}.asc`).join(','));
  const rows = [];
  for (let page = 0; page < 10; page++) {
    q.set('offset', String(rows.length));
    const result = await ctx.upstream(`${tableName}?${q}`, { headers: { Prefer: 'count=exact' } });
    if (!Array.isArray(result.data)) throw Error('Kết quả lookup không hợp lệ.');
    rows.push(...result.data);
    const countText = result.range?.split('/')[1],
      total = countText && countText !== '*' ? Number(countText) : null;
    if (total !== null && Number.isFinite(total)) {
      if (rows.length >= total) return rows;
      if (!result.data.length) throw Error('Không thể tải đầy đủ kết quả lookup.');
    } else if (result.data.length < 1000) return rows;
  }
  throw Error('Lookup có quá nhiều kết quả; hãy dùng cột đối chiếu có giá trị duy nhất.');
}
