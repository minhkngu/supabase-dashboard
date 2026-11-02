// Cột hiển thị có được sửa trực tiếp hay không.
// Formula đang bật và cột lookup đang đồng bộ do hệ thống quản lý nên chỉ đọc.

export function tableName(table) {
  return String(table?.name || '').replace(/^public\./, '');
}

export function sameTable(left, right) {
  if (!left || !right) return false;
  return tableName({ name: left }) === tableName({ name: right });
}

function optionsOf(column) {
  return Array.isArray(column?.options) ? column.options : [];
}

export function isWritableColumn(table, column, { formulas = [], lookups = [] } = {}) {
  if (!table || !column) return false;
  const currentTable = tableName(table);
  if (
    (formulas || []).some(
      (rule) =>
        rule?.enabled &&
        sameTable(rule.table, currentTable) &&
        rule.column === column.name,
    )
  )
    return false;
  if (
    (lookups || []).some(
      (config) =>
        sameTable(config?.sourceTable, currentTable) &&
        config?.sync?.enabled &&
        config.sync.columnName === column.name,
    )
  )
    return false;
  if (optionsOf(column).includes('generated')) return false;
  if (
    optionsOf(column).includes('identity') &&
    column.identity_generation === 'ALWAYS'
  )
    return false;
  return true;
}
