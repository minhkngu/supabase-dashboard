// Chuẩn bị dữ liệu cho "Nhân bản bản ghi" và nhận diện lỗi ràng buộc.
// Phần này thuần dữ liệu để có thể kiểm thử mà không cần database thật.

export const COPY_SUFFIX = ' copy';

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

function isSerialDefault(column) {
  return /nextval\s*\(/i.test(String(column?.default_value || ''));
}

function normalizedColumnName(column) {
  return String(column?.name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function isTemporalColumn(column) {
  return /^(date|time|timestamp)/i.test(columnType(column));
}

function hasCurrentTimeDefault(column) {
  return /(?:^|[^a-z_])(?:now|current_timestamp|current_date|current_time|localtimestamp|localtime|transaction_timestamp|statement_timestamp|clock_timestamp)\s*(?:\(\s*\))?/i.test(
    String(column?.default_value || ''),
  );
}

// created_at, updated_at... có default now()/CURRENT_TIMESTAMP do hệ thống quản lý:
// bỏ giá trị cũ để database điền thời điểm mới. Không áp dụng cho cột ngày
// nghiệp vụ như applied_on dù cột đó có default.
export function isAutomaticTimestampColumn(column) {
  if (!isTemporalColumn(column) || !hasCurrentTimeDefault(column)) return false;
  return /(^|_)(created|creation|inserted|insertion|updated|update|modified|modification)(_|$)/.test(
    normalizedColumnName(column),
  );
}

// Cột do database tạo giá trị, không nên đem giá trị cũ sang dòng mới.
export function isDatabaseGeneratedColumn(column) {
  const options = optionsOf(column);
  return (
    options.includes('generated') ||
    options.includes('identity') ||
    !!column?.identity_generation ||
    isSerialDefault(column) ||
    isAutomaticTimestampColumn(column)
  );
}

// Giữ đúng quy tắc của giao diện: formula đang bật và cột lookup đang đồng bộ
// không được sửa trực tiếp.
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

export function isCopyableColumn(table, column, config = {}) {
  if (!isWritableColumn(table, column, config)) return false;
  if (isDatabaseGeneratedColumn(column)) return false;
  if ((table.primary_keys || []).includes(column.name)) return false;
  return true;
}

function columnType(column) {
  return String(column?.format || column?.data_type || '').toLowerCase();
}

function isTextColumn(column) {
  const type = columnType(column);
  return (
    type === 'text' ||
    type === 'varchar' ||
    type === 'citext' ||
    type.startsWith('character varying')
  );
}

function isUuidColumn(column) {
  const type = columnType(column);
  return type === 'uuid' || type.endsWith(' uuid') || type.includes('uuid');
}

function isEnumColumn(column) {
  return (
    (Array.isArray(column?.enum_values) && column.enum_values.length > 0) ||
    columnType(column).startsWith('enum')
  );
}

function looksLikeEmailOrUrl(column) {
  const pattern =
    /(^|_)(e?mail|url|uri|website|web|link|href|slug|permalink)/i;
  return pattern.test(String(column?.name || '')) ||
    pattern.test(String(column?.description || ''));
}

export function isLinkColumn(table, column, { definitions = [] } = {}) {
  const currentTable = tableName(table);
  if (
    (table.foreign_key_constraints || []).some(
      (constraint) =>
        sameTable(constraint.source_table, currentTable) &&
        (constraint.source_columns || []).includes(column.name),
    )
  )
    return true;
  if (
    (definitions || []).some(
      (definition) =>
        sameTable(definition.source_table, currentTable) &&
        ((definition.kind === 'relation' &&
          (definition.config?.sourceKeys || []).includes(column.name)) ||
          (definition.kind === 'lookup' &&
            definition.config?.legacy?.sourceColumn === column.name)),
    )
  )
    return true;
  // Hậu tố chữ "copy" không phù hợp với cột khóa/định danh dạng văn bản
  // dù metadata chưa khai báo khóa ngoại.
  return /(^|_)(id|uuid|key)$/i.test(String(column.name || ''));
}

function isNameCandidate(table, column, config) {
  if (!column || !isTextColumn(column)) return false;
  if (isEnumColumn(column) || isUuidColumn(column)) return false;
  if (!isWritableColumn(table, column, config)) return false;
  if (isDatabaseGeneratedColumn(column)) return false;
  if (looksLikeEmailOrUrl(column)) return false;
  if (isLinkColumn(table, column, config)) return false;
  return true;
}

export function duplicateNameColumn(table, config = {}) {
  const candidates = (table?.columns || []).filter((column) =>
    isNameCandidate(table, column, config),
  );
  const named = (value) =>
    candidates.find((column) => column.name.toLowerCase() === value);
  return named('name') || named('title') || candidates[0] || null;
}

function copiedValue(value) {
  if (value === undefined) return null;
  if (value && typeof value === 'object') return structuredClone(value);
  return value;
}

function primaryKeyNeedsInput(table) {
  const columns = new Map((table.columns || []).map((c) => [c.name, c]));
  return (table.primary_keys || []).filter((key) => {
    const column = columns.get(key);
    if (!column) return true;
    if (isDatabaseGeneratedColumn(column)) return false;
    return !column.default_value;
  });
}

/**
 * Trả về dữ liệu sẽ gửi tới API thêm bản ghi hiện có.
 * - Bỏ khóa chính, cột generated/identity/serial, formula và lookup đồng bộ.
 * - Giữ số, ngày, boolean, null và giá trị khóa ngoại.
 * - Chưa đổi cột tên: chỉ cột thuộc ràng buộc unique mới được xử lý ở bước sau.
 * - attention: các trường cần người dùng bổ sung trước khi gửi.
 */
export function buildDuplicatePlan(
  table,
  row,
  { formulas = [], lookups = [], definitions = [] } = {},
) {
  if (!table || !row) throw Error('Không có bản ghi để nhân bản.');
  const config = { formulas, lookups, definitions };
  const values = {};
  for (const column of table.columns || []) {
    if (!isCopyableColumn(table, column, config)) continue;
    values[column.name] = copiedValue(row[column.name]);
  }

  const nameColumn = duplicateNameColumn(table, config);
  const attention = [];
  for (const key of primaryKeyNeedsInput(table)) {
    attention.push({
      column: key,
      reason: 'Khóa chính không tự sinh; nhập giá trị mới cho bản ghi.',
    });
  }

  const constraints = (table.unique_constraints || [])
    .map((constraint) => ({
      name: constraint?.name,
      columns: [...new Set(constraint?.columns || [])],
    }))
    .filter((constraint) => constraint.columns.length);

  return {
    table,
    config,
    values,
    nameColumn: nameColumn?.name || null,
    changedColumns: [],
    attention,
    needsForm: attention.length > 0,
    uniqueFields: [
      ...new Set(
        constraints.flatMap((constraint) =>
          constraint.columns.filter(
            (column) => values[column] !== undefined,
          ),
        ),
      ),
    ],
    constraints,
  };
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined)
    return false;
  if (typeof left === 'object' || typeof right === 'object')
    return JSON.stringify(left) === JSON.stringify(right);
  return String(left) === String(right);
}

function comboExists(rows, constraint, values) {
  return rows.some((row) =>
    constraint.columns.every((column) =>
      sameValue(row[column], values[column]),
    ),
  );
}

function addAttention(plan, column, reason) {
  if (plan.attention.some((item) => item.column === column)) return;
  plan.attention.push({ column, reason });
}

function suffixCandidates(base, maxCandidates) {
  const candidates = [];
  for (let index = 1; index <= maxCandidates; index++) {
    const value = index === 1 ? `${base}${COPY_SUFFIX}` : `${base}${COPY_SUFFIX} ${index}`;
    if (value.length <= 500) candidates.push(value);
  }
  return candidates;
}

function preferredUniqueTarget(table, constraint, config, values) {
  const columns = constraint.columns
    .map((name) => (table.columns || []).find((column) => column.name === name))
    .filter(
      (column) =>
        column && values[column.name] !== undefined && isNameCandidate(table, column, config),
    );
  const preferred = duplicateNameColumn(table, config);
  return (
    columns.find((column) => column.name === preferred?.name) ||
    columns[0] ||
    null
  );
}

/**
 * Kiểm tra unique trên toàn bảng và đổi đúng một trường văn bản khi cần.
 * fetchRows(column, values) phải trả về mọi bản ghi trong bảng có giá trị
 * tương ứng ở cột đó, không giới hạn theo trang hoặc bộ lọc hiện tại.
 */
export async function resolveDuplicatePlan(
  plan,
  { fetchRows, maxCandidates = 50 } = {},
) {
  if (!plan || !plan.constraints?.length) return plan;
  if (typeof fetchRows !== 'function')
    throw Error('Thiếu hàm kiểm tra giá trị unique.');

  const { table, config, values } = plan;
  const changed = new Set(plan.changedColumns);
  for (const constraint of plan.constraints) {
    if (
      constraint.columns.some(
        (column) => values[column] === undefined || values[column] === null,
      )
    )
      continue;

    const target = preferredUniqueTarget(table, constraint, config, values);
    if (!target) {
      const markable = constraint.columns
        .map((name) => (table.columns || []).find((column) => column.name === name))
        .find(
          (column) =>
            column &&
            values[column.name] !== undefined &&
            !isDatabaseGeneratedColumn(column),
        );
      if (markable)
        addAttention(
          plan,
          markable.name,
          'Trường có ràng buộc unique nhưng không thể tự tạo giá trị hợp lệ; nhập giá trị khác.',
        );
      continue;
    }

    if (
      constraint.columns.some((column) => changed.has(column)) &&
      typeof values[target.name] === 'string' &&
      values[target.name].length <= 500
    ) {
      const currentRows = await fetchRows(target.name, [values[target.name]]);
      if (!comboExists(currentRows, constraint, values)) continue;
    }

    const base = typeof values[target.name] === 'string' ? values[target.name] : String(values[target.name]);
    const candidates = suffixCandidates(base, maxCandidates);
    let next = null;
    for (let offset = 0; offset < candidates.length && next === null; offset += 25) {
      const batch = candidates.slice(offset, offset + 25);
      const rows = await fetchRows(target.name, batch);
      next =
        batch.find(
          (candidate) =>
            !comboExists(rows, constraint, {
              ...values,
              [target.name]: candidate,
            }),
        ) || null;
    }
    if (next === null) {
      addAttention(
        plan,
        target.name,
        'Không tìm được giá trị không trùng; nhập giá trị khác trước khi thêm.',
      );
      continue;
    }
    values[target.name] = next;
    changed.add(target.name);
    plan.changedColumns.push(target.name);
  }

  plan.changedColumns = [...changed];
  plan.needsForm = plan.attention.length > 0;
  return plan;
}

function constraintColumnsForMessage(table, message) {
  const fields = new Set();
  for (const constraint of table?.unique_constraints || []) {
    if (constraint?.name && message.includes(constraint.name)) {
      for (const column of constraint.columns || []) fields.add(column);
    }
  }
  if (/pkey|primary key/i.test(message)) {
    for (const column of table?.primary_keys || []) fields.add(column);
  }
  return [...fields];
}

/**
 * Phân loại lỗi ghi để quyết định mở lại form hay chỉ báo lỗi mạng.
 * Không tự động thử lại bất kỳ thao tác ghi nào.
 */
export function duplicateFailure(table, error, plan = {}) {
  const message = String(error?.message || '');
  const status = Number(error?.status);
  const unique =
    /duplicate key|unique constraint|23505/i.test(message) || status === 409;
  if (unique) {
    const fields = constraintColumnsForMessage(table, message);
    const fallback = plan.uniqueFields?.length
      ? plan.uniqueFields
      : plan.nameColumn
        ? [plan.nameColumn]
        : [];
    return {
      kind: 'unique',
      fields: fields.length ? fields : [...new Set(fallback)],
    };
  }
  if (/null value|not-null|23502/i.test(message)) {
    const match =
      message.match(/null value in column "([^"]+)"/i) ||
      message.match(/column "([^"]+)"/i);
    return { kind: 'missing', fields: match ? [match[1]] : [] };
  }
  if (error?.network || error?.name === 'TypeError' || !Number.isInteger(status))
    return { kind: 'network', fields: [] };
  return { kind: 'error', fields: [] };
}
