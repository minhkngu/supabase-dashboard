// One SVG icon set for column types, pins and menus (stroke icons, 24px grid).
const PATHS = {
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  number: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  boolean: 'M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6zM16 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  date: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  json: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1',
  uuid: 'M3 5h18v14H3zM7 10h4M7 14h6M15 10h2M15 14h2',
  enum: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  key: 'M14.5 4.5a5 5 0 1 1-3.6 8.5L4 20M7 17l2 2M10 14l2 2',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  lookup: 'M7 17 17 7M7 7h10v10',
  pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

/**
 * @param {string} name one of the keys of PATHS
 * @param {{ size?: number, filled?: boolean }} [options]
 */
export function icon(name, { size = 14, filled = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' ? '3' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', `icon-${name}`);
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

const NUMERIC = /^(smallint|integer|bigint|numeric|decimal|real|double precision)$/;

/** The icon and colour class describing a column's kind. */
export function columnKind(column, table) {
  if (table?.primary_keys?.includes(column.name)) return { icon: 'key', type: 'key', label: 'Khóa chính' };
  const foreign = (table?.foreign_key_constraints || []).some(
    f => f.source_table === table.name && f.source_columns?.includes(column.name),
  );
  if (foreign) return { icon: 'link', type: 'link', label: 'Khóa ngoại' };
  if (column.enum_values?.length) return { icon: 'enum', type: 'enum', label: 'Danh sách giá trị' };
  if (column.data_type === 'uuid') return { icon: 'uuid', type: 'uuid', label: 'UUID' };
  if (column.data_type === 'boolean') return { icon: 'boolean', type: 'bool', label: 'Đúng/sai' };
  if (NUMERIC.test(column.data_type)) return { icon: 'number', type: 'num', label: 'Số' };
  if (/date|time/.test(column.data_type)) return { icon: 'date', type: 'date', label: 'Ngày giờ' };
  if (/json/.test(column.data_type) || column.data_type.startsWith('_'))
    return { icon: 'json', type: 'json', label: 'JSON' };
  return { icon: 'text', type: 't', label: 'Văn bản' };
}
