const textual = new Set(['text', 'character varying', 'character', 'varchar']);
const allowed = new Set([
  'contains',
  'startswith',
  'eq',
  'equals',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'not_empty',
]);
export function filterQuery(params, table) {
  const q = new URLSearchParams(),
    cols = new Map(table.columns.map(c => [c.name, c]));
  const search = params.get('search')?.trim(),
    searchColumn = params.get('search_column');
  if (
    searchColumn &&
    (!cols.has(searchColumn) || !['text', 'character varying'].includes(cols.get(searchColumn).data_type))
  )
    throw Error('Cột tìm kiếm không hợp lệ');
  if (search) {
    const candidates = table.columns.filter(
      c => ['text', 'character varying'].includes(c.data_type) && (!searchColumn || c.name === searchColumn),
    );
    if (candidates.length)
      q.set('or', `(${candidates.map(c => `${c.name}.ilike.*${search.replace(/[,*().\\]/g, ' ')}*`).join(',')})`);
  }
  const requested = params.get('filters');
  if (requested) {
    let filters;
    try {
      filters = JSON.parse(requested);
    } catch {
      throw Error('Bộ lọc không hợp lệ');
    }
    if (!Array.isArray(filters) || filters.length > 100) throw Error('Bộ lọc không hợp lệ');
    for (const f of filters) {
      if (!f || !cols.has(f.column) || !allowed.has(f.operator || 'contains'))
        throw Error('Điều kiện lọc không hợp lệ');
      const c = cols.get(f.column),
        op = f.operator || 'contains',
        value = f.value == null ? '' : String(f.value).trim();
      if (op === 'empty' || op === 'not_empty') {
        q.append(f.column, op === 'empty' ? 'is.null' : 'not.is.null');
        continue;
      }
      if (value === '') continue;
      if ((op === 'contains' || op === 'startswith') && !textual.has(c.data_type))
        throw Error('Kiểu cột không hỗ trợ tìm theo văn bản.');
      const safe = value.replace(/[,*().\\]/g, ' ');
      q.append(
        f.column,
        op === 'contains'
          ? `ilike.*${safe}*`
          : op === 'startswith'
            ? `ilike.${safe}*`
            : `${op === 'equals' ? 'eq' : op}.${value}`,
      );
    }
  } else {
    const field = params.get('field'),
      value = params.get('value');
    if (field && value !== null && value !== '') {
      const c = cols.get(field);
      if (!c) throw Error('Cột lọc không hợp lệ');
      q.set(field, c.data_type === 'text' ? `ilike.*${value.replace(/[,*().\\]/g, ' ')}*` : `eq.${value}`);
    }
  }
  const requestedOrder = params.get('orders');
  let order = [];
  if (requestedOrder) {
    let parsed;
    try {
      parsed = JSON.parse(requestedOrder);
    } catch {
      throw Error('Thứ tự sắp xếp không hợp lệ');
    }
    if (!Array.isArray(parsed) || parsed.length > table.columns.length) throw Error('Thứ tự sắp xếp không hợp lệ');
    const seen = new Set();
    for (const item of parsed) {
      if (
        !item ||
        !cols.has(item.column) ||
        !['asc', 'desc'].includes(item.direction) ||
        seen.has(item.column) ||
        /json|array|bytea/i.test(cols.get(item.column).data_type)
      )
        throw Error('Cột sắp xếp không hợp lệ');
      seen.add(item.column);
      order.push(`${item.column}.${item.direction}`);
    }
  } else {
    const sort = params.get('sort');
    if (sort) {
      if (!cols.has(sort)) throw Error('Cột sắp xếp không hợp lệ');
      order.push(`${sort}.${params.get('direction') === 'desc' ? 'desc' : 'asc'}`);
    }
  }
  for (const pk of table.primary_keys || []) if (!order.some(x => x.startsWith(`${pk}.`))) order.push(`${pk}.asc`);
  if (order.length) q.set('order', order.join(','));
  return q;
}
