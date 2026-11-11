import { filterQuery } from '../../filters.mjs';
import { body, response } from '../http.mjs';
import { columns } from '../context.mjs';

function cleanValues(values, t, method) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('Dữ liệu không hợp lệ');
  const cols = columns(t);
  for (const k of Object.keys(values)) {
    const c = cols.get(k);
    if (
      !c ||
      (method === 'PATCH' && t.primary_keys.includes(k)) ||
      c.options.includes('generated') ||
      (c.options.includes('identity') && c.identity_generation === 'ALWAYS')
    )
      throw Error(`Không thể sửa cột ${k}`);
  }
  return values;
}

export async function handleTable(ctx, req, res, u) {
  const match = u.pathname.match(/^\/api\/table\/([a-zA-Z0-9_]+)$/);
  if (!match) return false;
  const name = match[1],
    t = ctx.meta(name);
  if (req.method === 'GET') {
    const q = filterQuery(u.searchParams, t),
      page = Math.max(0, Math.min(100000, Number(u.searchParams.get('page')) || 0)),
      limit = Math.max(1, Math.min(1000, Number(u.searchParams.get('limit')) || 50));
    q.set('select', t.columns.map(c => '"' + c.name.replaceAll('"', '\\"') + '"').join(','));
    q.set('limit', String(limit));
    q.set('offset', String(page * limit));
    // count=0 skips the exact count when the client already knows the total.
    const withCount = u.searchParams.get('count') !== '0';
    const { data, range } = await ctx.upstream(`${name}?${q}`, withCount ? { headers: { Prefer: 'count=exact' } } : {});
    const total = withCount ? Number(range?.split('/')[1]) || 0 : null;
    response(res, 200, { rows: data, total, page, limit });
    return true;
  }
  if (!t.primary_keys?.length) {
    response(res, 403, { error: 'Bảng không có khóa chính; chỉ có thể xem dữ liệu.' });
    return true;
  }
  const b = await body(req);
  const method = req.method,
    q = new URLSearchParams();
  if (method === 'PATCH' || method === 'DELETE') {
    for (const pk of t.primary_keys) {
      if (b.key?.[pk] === undefined || b.key[pk] === null) throw Error('Thiếu khóa chính');
      q.set(pk, `eq.${b.key[pk]}`);
    }
  }
  if (method === 'PATCH' && b.expected !== undefined) {
    if (!b.expected || typeof b.expected !== 'object' || Array.isArray(b.expected))
      throw Error('Điều kiện cập nhật không hợp lệ');
    const entries = Object.entries(b.expected);
    if (!entries.length || entries.length > t.columns.length) throw Error('Điều kiện cập nhật không hợp lệ');
    for (const [column, value] of entries) {
      if (
        !columns(t).has(column) ||
        !Object.hasOwn(b.values || {}, column) ||
        (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      )
        throw Error('Điều kiện cập nhật không hợp lệ');
      q.append(column, value === null ? 'is.null' : `eq.${value}`);
    }
  }
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
    response(res, 405, { error: 'Không hỗ trợ' });
    return true;
  }
  if (method !== 'DELETE') {
    const formulas = (await ctx.cachedConfig('formula', () => ctx.admin.formulaSync.list())).filter(
      f => f.enabled && f.table === name,
    );
    if (formulas.some(f => Object.hasOwn(b.values || {}, f.column)))
      throw Error('Cột formula đang tự tính; hãy tắt formula trước khi sửa.');
    const synced = (await ctx.cachedLookups()).filter(c => c.sourceTable === name && c.sync?.enabled);
    if (synced.some(c => Object.hasOwn(b.values || {}, c.sync.columnName)))
      throw Error('Cột lookup đang đồng bộ tự động; hãy tắt đồng bộ trước khi sửa.');
  }
  const result = await ctx.upstream(`${name}?${q}`, {
    method,
    headers: { Prefer: 'return=representation' },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(cleanValues(b.values, t, method)) }),
  });
  if ((method === 'PATCH' || method === 'DELETE') && !result.data?.length)
    throw Error('Không có bản ghi nào được cập nhật. Kiểm tra quyền hoặc dữ liệu đã thay đổi.');
  response(res, 200, { rows: result.data });
  return true;
}
