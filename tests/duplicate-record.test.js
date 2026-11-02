import { describe, expect, it } from 'vitest';
import {
  buildDuplicatePlan,
  duplicateFailure,
  duplicateNameColumn,
  isWritableColumn,
  resolveDuplicatePlan,
} from '../duplicate-record.mjs';

const baseColumns = [
  { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
  { name: 'name', data_type: 'text', options: ['nullable', 'updatable'] },
  { name: 'sku', data_type: 'text', options: ['nullable', 'updatable'] },
  { name: 'price', data_type: 'numeric', format: 'numeric(12,2)', options: ['nullable', 'updatable'] },
  { name: 'quantity', data_type: 'integer', options: ['nullable', 'updatable'] },
  { name: 'active', data_type: 'boolean', options: ['nullable', 'updatable'] },
  { name: 'released_on', data_type: 'date', format: 'date', options: ['nullable', 'updatable'] },
  { name: 'branchid', data_type: 'uuid', format: 'uuid', options: ['nullable', 'updatable'] },
  { name: 'note', data_type: 'text', options: ['nullable', 'updatable'] },
  { name: 'display_name', data_type: 'text', options: ['generated', 'nullable', 'updatable'] },
  { name: 'formula_total', data_type: 'numeric', options: ['nullable', 'updatable'] },
  { name: 'lookup_branch', data_type: 'text', options: ['nullable', 'updatable'] },
];

function table(overrides = {}) {
  return {
    name: 'public.products',
    columns: baseColumns,
    primary_keys: ['id'],
    unique_constraints: [],
    foreign_key_constraints: [],
    ...overrides,
  };
}

const baseRow = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Sữa',
  sku: 'SKU-1',
  price: '1250.50',
  quantity: 3,
  active: true,
  released_on: '2026-01-02',
  branchid: '00000000-0000-0000-0000-000000000002',
  note: null,
  display_name: 'Chi nhánh - Sữa',
  formula_total: '999',
  lookup_branch: 'Chi nhánh 1',
};

describe('buildDuplicatePlan', () => {
  it('giữ kiểu dữ liệu, khóa ngoại và giá trị trống; bỏ cột tự sinh/tự tính', () => {
    const plan = buildDuplicatePlan(table(), baseRow, {
      formulas: [{ table: 'products', column: 'formula_total', enabled: true }],
      lookups: [
        {
          sourceTable: 'products',
          sync: { enabled: true, columnName: 'lookup_branch' },
        },
      ],
    });

    expect(plan.values).toEqual({
      name: 'Sữa',
      sku: 'SKU-1',
      price: '1250.50',
      quantity: 3,
      active: true,
      released_on: '2026-01-02',
      branchid: '00000000-0000-0000-0000-000000000002',
      note: null,
    });
    expect(plan.values.id).toBeUndefined();
    expect(plan.values.display_name).toBeUndefined();
    expect(plan.values.formula_total).toBeUndefined();
    expect(plan.values.lookup_branch).toBeUndefined();
    expect(plan.nameColumn).toBe('name');
    expect(plan.needsForm).toBe(false);
    expect(baseRow.name).toBe('Sữa');
  });

  it('ưu tiên name, sau đó title, rồi cột văn bản thường đầu tiên', () => {
    const named = table({
      columns: [
        { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
        { name: 'title', data_type: 'text', options: ['updatable'] },
        { name: 'name', data_type: 'text', options: ['updatable'] },
      ],
    });
    expect(duplicateNameColumn(named)?.name).toBe('name');

    const titled = table({
      columns: [
        { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
        { name: 'title', data_type: 'text', options: ['updatable'] },
        { name: 'description', data_type: 'text', options: ['updatable'] },
      ],
    });
    expect(duplicateNameColumn(titled)?.name).toBe('title');

    const firstText = table({
      columns: [
        { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
        { name: 'description', data_type: 'text', options: ['nullable', 'updatable'] },
        { name: 'sku', data_type: 'text', options: ['nullable', 'updatable'] },
      ],
    });
    expect(duplicateNameColumn(firstText)?.name).toBe('description');
  });

  it('không thêm hậu tố vào enum, uuid, email, url hoặc cột liên kết', () => {
    const noSafeName = table({
      columns: [
        { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
        { name: 'name', data_type: 'text', options: ['updatable'], enum_values: ['a', 'b'] },
        { name: 'email', data_type: 'text', options: ['nullable', 'updatable'] },
        { name: 'website_url', data_type: 'text', options: ['nullable', 'updatable'] },
        { name: 'external_uuid', data_type: 'uuid', format: 'uuid', options: ['nullable', 'updatable'] },
        { name: 'branchid', data_type: 'text', options: ['nullable', 'updatable'] },
      ],
      foreign_key_constraints: [
        {
          name: 'products_branch_fkey',
          source_table: 'public.products',
          source_columns: ['branchid'],
          target_table: 'public.branches',
          target_columns: ['id'],
        },
      ],
    });
    const plan = buildDuplicatePlan(noSafeName, {
      ...baseRow,
      name: 'Sản phẩm',
      email: 'a@example.com',
      website_url: 'https://example.com',
      external_uuid: '00000000-0000-0000-0000-000000000003',
    });

    expect(plan.nameColumn).toBeNull();
    expect(plan.values.name).toBe('Sản phẩm');
    expect(plan.values.email).toBe('a@example.com');
    expect(plan.values.website_url).toBe('https://example.com');
    expect(plan.values.branchid).toBe(baseRow.branchid);
  });

  it('giữ giá trị trống của cột tên thay vì tạo tên chỉ có hậu tố', () => {
    const plan = buildDuplicatePlan(table(), { ...baseRow, name: null });
    expect(plan.values.name).toBeNull();
    expect(plan.changedColumns).toEqual([]);
  });

  it('để database điền thời điểm tạo mới nhưng giữ trường nghiệp vụ có default', () => {
    const withTimestamps = table({
      columns: [
        { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
        { name: 'name', data_type: 'text', options: ['nullable', 'updatable'] },
        { name: 'applied_on', data_type: 'date', format: 'date', options: ['nullable', 'updatable'], default_value: 'now()' },
        { name: 'renewed_on', data_type: 'date', format: 'date', options: ['nullable', 'updatable'], default_value: "'2020-01-01'::date" },
        { name: 'price', data_type: 'numeric', options: ['nullable', 'updatable'], default_value: '0' },
        { name: 'status', data_type: 'text', options: ['nullable', 'updatable'], default_value: "'draft'::text" },
        { name: 'branchid', data_type: 'uuid', format: 'uuid', options: ['nullable', 'updatable'] },
        { name: 'created_at', data_type: 'timestamp with time zone', format: 'timestamp with time zone', options: ['nullable', 'updatable'], default_value: 'now()' },
        { name: 'updated_at', data_type: 'timestamp with time zone', format: 'timestamp with time zone', options: ['nullable', 'updatable'], default_value: "timezone('utc'::text, now())" },
        { name: 'insertedAt', data_type: 'timestamp without time zone', format: 'timestamp without time zone', options: ['nullable', 'updatable'], default_value: 'CURRENT_TIMESTAMP' },
      ],
    });
    const plan = buildDuplicatePlan(withTimestamps, {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Sữa',
      applied_on: '2026-01-02',
      renewed_on: '2019-12-31',
      price: '1250.50',
      status: 'active',
      branchid: '00000000-0000-0000-0000-000000000002',
      created_at: '2020-01-01T00:00:00+00:00',
      updated_at: '2020-01-02T00:00:00+00:00',
      insertedAt: '2020-01-03T00:00:00+00:00',
    });

    expect(plan.values).toEqual({
      name: 'Sữa',
      applied_on: '2026-01-02',
      renewed_on: '2019-12-31',
      price: '1250.50',
      status: 'active',
      branchid: '00000000-0000-0000-0000-000000000002',
    });
    expect(plan.values.created_at).toBeUndefined();
    expect(plan.values.updated_at).toBeUndefined();
    expect(plan.values.insertedAt).toBeUndefined();
    expect(plan.needsForm).toBe(false);
  });

  it('mở form khi khóa chính không tự sinh nhưng vẫn xử lý unique trong bản nháp', async () => {
    const manual = table({
      columns: baseColumns.map((column) =>
        column.name === 'id'
          ? { name: 'id', data_type: 'integer', options: ['updatable'] }
          : column,
      ),
      unique_constraints: [{ name: 'products_sku_key', columns: ['sku'] }],
    });
    const plan = buildDuplicatePlan(manual, { ...baseRow, id: 7 });

    expect(plan.needsForm).toBe(true);
    expect(plan.values.id).toBeUndefined();
    expect(plan.values.name).toBe('Sữa');
    expect(plan.attention).toEqual([
      expect.objectContaining({ column: 'id' }),
    ]);

    await resolveDuplicatePlan(plan, { fetchRows: async () => [] });
    expect(plan.values.sku).toBe('SKU-1 copy');
    expect(plan.needsForm).toBe(true);
  });

  it('giữ nguyên name khi không unique và không cần kiểm tra toàn bảng', async () => {
    const plan = buildDuplicatePlan(table(), baseRow);
    let checks = 0;
    await resolveDuplicatePlan(plan, {
      fetchRows: async () => {
        checks++;
        return [];
      },
    });
    expect(plan.values.name).toBe('Sữa');
    expect(plan.changedColumns).toEqual([]);
    expect(plan.needsForm).toBe(false);
    expect(checks).toBe(0);
  });

  it('thêm copy rồi copy 2 cho trường unique văn bản khi đã tồn tại', async () => {
    const uniqueSku = table({
      unique_constraints: [{ name: 'products_sku_key', columns: ['sku'] }],
    });
    const existing = [{ ...baseRow }];
    const fetchRows = async (column, values) => {
      const wanted = new Set(values.map(String));
      return existing.filter((row) => wanted.has(String(row[column])));
    };

    const first = buildDuplicatePlan(uniqueSku, baseRow);
    await resolveDuplicatePlan(first, { fetchRows });
    expect(first.values.sku).toBe('SKU-1 copy');
    expect(first.values.name).toBe('Sữa');
    expect(first.changedColumns).toEqual(['sku']);

    existing.push({ ...baseRow, id: 'copy-id', sku: 'SKU-1 copy' });
    const second = buildDuplicatePlan(uniqueSku, baseRow);
    await resolveDuplicatePlan(second, { fetchRows });
    expect(second.values.sku).toBe('SKU-1 copy 2');
  });

  it('unique nhiều cột chỉ đổi một trường văn bản và giữ khóa ngoại', async () => {
    const composite = table({
      unique_constraints: [
        { name: 'products_sku_branch_key', columns: ['sku', 'branchid'] },
      ],
    });
    const existing = [
      { ...baseRow },
      { ...baseRow, id: 'copy-id', sku: 'SKU-1 copy' },
    ];
    const fetchRows = async (column, values) => {
      const wanted = new Set(values.map(String));
      return existing.filter((row) => wanted.has(String(row[column])));
    };

    const plan = buildDuplicatePlan(composite, baseRow);
    await resolveDuplicatePlan(plan, { fetchRows });

    expect(plan.values.sku).toBe('SKU-1 copy 2');
    expect(plan.values.branchid).toBe(baseRow.branchid);
    expect(plan.values.name).toBe('Sữa');
    expect(plan.changedColumns).toEqual(['sku']);
  });

  it('không đổi giá trị unique null và chỉ mở form khi không thể tạo giá trị hợp lệ', async () => {
    const uniqueSku = table({
      unique_constraints: [{ name: 'products_sku_key', columns: ['sku'] }],
    });
    let checks = 0;
    const nullable = buildDuplicatePlan(uniqueSku, { ...baseRow, sku: null });
    await resolveDuplicatePlan(nullable, {
      fetchRows: async () => {
        checks++;
        return [];
      },
    });
    expect(nullable.needsForm).toBe(false);
    expect(nullable.values.sku).toBeNull();
    expect(checks).toBe(0);

    const uniqueEmail = table({
      columns: [
        ...baseColumns,
        { name: 'email', data_type: 'text', options: ['nullable', 'updatable'] },
      ],
      unique_constraints: [{ name: 'products_email_key', columns: ['email'] }],
    });
    const emailPlan = buildDuplicatePlan(uniqueEmail, {
      ...baseRow,
      email: 'a@example.com',
    });
    await resolveDuplicatePlan(emailPlan, {
      fetchRows: async () => {
        throw Error('không nên gọi kiểm tra');
      },
    });
    expect(emailPlan.needsForm).toBe(true);
    expect(emailPlan.values.email).toBe('a@example.com');
    expect(emailPlan.attention).toEqual([
      expect.objectContaining({ column: 'email' }),
    ]);
  });

  it('không coi formula đang bật hoặc lookup đồng bộ là cột được sửa', () => {
    const products = table();
    const formula = products.columns.find((column) => column.name === 'formula_total');
    const lookup = products.columns.find((column) => column.name === 'lookup_branch');
    expect(
      isWritableColumn(products, formula, {
        formulas: [{ table: 'products', column: 'formula_total', enabled: true }],
      }),
    ).toBe(false);
    expect(
      isWritableColumn(products, lookup, {
        lookups: [
          {
            sourceTable: 'products',
            sync: { enabled: true, columnName: 'lookup_branch' },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('duplicateFailure', () => {
  const products = table({
    unique_constraints: [{ name: 'products_sku_key', columns: ['sku'] }],
  });

  it('nhận diện lỗi unique và chỉ ra cột theo tên ràng buộc', () => {
    const failure = duplicateFailure(
      products,
      Error('duplicate key value violates unique constraint "products_sku_key"'),
    );
    expect(failure).toEqual({ kind: 'unique', fields: ['sku'] });
  });

  it('nhận diện lỗi unique chung và gợi ý các cột unique/cột tên', () => {
    const failure = duplicateFailure(
      table(),
      Object.assign(Error('conflict'), { status: 409 }),
      { uniqueFields: ['code'], nameColumn: 'name' },
    );
    expect(failure.kind).toBe('unique');
    expect(failure.fields).toEqual(['code']);
  });

  it('phân biệt lỗi mạng, lỗi thiếu giá trị và lỗi quyền', () => {
    expect(
      duplicateFailure(
        table(),
        Object.assign(new TypeError('Failed to fetch'), { network: true }),
      ).kind,
    ).toBe('network');
    expect(
      duplicateFailure(
        table(),
        Error('null value in column "sku" of relation "products" violates not-null constraint'),
      ),
    ).toEqual({ kind: 'missing', fields: ['sku'] });
    expect(
      duplicateFailure(table(), Object.assign(Error('forbidden'), { status: 403 })),
    ).toEqual({ kind: 'error', fields: [] });
  });
});
