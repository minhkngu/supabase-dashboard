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

// Counts rows per group across the whole filtered table, so group headers do
// not only describe the current page. paths is a JSON list of group paths,
// each a list of [column, value] pairs.
async function groupCounts(ctx, t, name, params) {
  let paths;
  try {
    paths = JSON.parse(params.get('paths') || '[]');
  } catch {
    throw Error('Nhóm không hợp lệ.');
  }
  const cols = columns(t);
  if (!Array.isArray(paths) || paths.length > 100) throw Error('Nhóm không hợp lệ.');
  for (const path of paths)
    if (
      !Array.isArray(path) ||
      !path.length ||
      path.length > 5 ||
      path.some(
        pair =>
          !Array.isArray(pair) ||
          !cols.has(pair[0]) ||
          (pair[1] !== null && !['string', 'number', 'boolean'].includes(typeof pair[1])),
      )
    )
      throw Error('Nhóm không hợp lệ.');
  const counts = new Array(paths.length);
  for (let start = 0; start < paths.length; start += 5)
    await Promise.all(
      paths.slice(start, start + 5).map(async (path, offset) => {
        const q = filterQuery(params, t);
        for (const [column, value] of path) q.append(column, value === null ? 'is.null' : `eq.${value}`);
        q.set('select', '"' + path[0][0].replaceAll('"', '\\"') + '"');
        q.set('limit', '1');
        const { range } = await ctx.upstream(`${name}?${q}`, { headers: { Prefer: 'count=exact' } });
        const total = Number(range?.split('/')[1]);
        counts[start + offset] = Number.isFinite(total) ? total : null;
      }),
    );
  return counts;
}

export async function handleTable(ctx, req, res, u) {
  const grouped = u.pathname.match(/^\/api\/table\/([a-zA-Z0-9_]+)\/group-counts$/);
  if (grouped && req.method === 'GET') {
    const t = ctx.meta(grouped[1]);
    response(res, 200, { counts: await groupCounts(ctx, t, grouped[1], u.searchParams) });
    return true;
  }
  const batch = u.pathname.match(/^\/api\/table\/([a-zA-Z0-9_]+)\/batch$/);
  if (batch) {
    if (req.method !== 'POST') {
      response(res, 405, { error: 'Không hỗ trợ' });
      return true;
    }
    const name = batch[1],
      t = ctx.meta(name),
      input = await body(req);
    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 50)
      throw Error('Danh sách thay đổi phải có từ 1 đến 50 dòng.');
    const seen = new Set();
    for (const change of input.changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) throw Error('Thay đổi không hợp lệ.');
      if (t.primary_keys.length && t.primary_keys.every(k => change.key?.[k] != null)) {
        const key = JSON.stringify(t.primary_keys.map(k => change.key[k]));
        if (seen.has(key)) throw Error('Không thể gửi trùng khóa trong một lô.');
        seen.add(key);
      }
    }
    const results = new Array(input.changes.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(5, input.changes.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= input.changes.length) return;
          try {
            const result = await writeTable(ctx, t, name, 'PATCH', input.changes[i]);
            results[i] = { ok: true, rows: result.rows };
          } catch (error) {
            results[i] = { ok: false, error: error.message || 'Không thể lưu dòng.' };
          }
        }
      }),
    );
    response(res, 200, { results });
    return true;
  }
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
    // count=none skips the exact count when the client already knows the total.
    const withCount = !['none', '0'].includes(u.searchParams.get('count'));
    const { data, range } = await ctx.upstream(`${name}?${q}`, withCount ? { headers: { Prefer: 'count=exact' } } : {});
    const total = withCount ? Number(range?.split('/')[1]) || 0 : null;
    response(res, 200, { rows: data, total, page, limit });
    return true;
  }
  response(res, 200, await writeTable(ctx, t, name, req.method, await body(req)));
  return true;
}

// Applies one POST, PATCH or DELETE through the Data API. The batch route runs
// this five times at once and reports the outcome per row.
async function writeTable(ctx, t, name, method, b) {
  if (!t.primary_keys?.length)
    throw Object.assign(Error('Bảng không có khóa chính; chỉ có thể xem dữ liệu.'), { status: 403 });
  const q = new URLSearchParams();
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
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw Object.assign(Error('Không hỗ trợ'), { status: 405 });
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
  return { rows: result.data };
}
