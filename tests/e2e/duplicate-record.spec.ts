import { test, expect, type Page, type Route } from '@playwright/test';

const productsTable = {
  name: 'public.products',
  primary_keys: ['id'],
  unique_constraints: [] as Array<{ name: string; columns: string[] }>,
  foreign_key_constraints: [] as Array<Record<string, unknown>>,
  columns: [
    { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
    { name: 'name', data_type: 'text', options: ['nullable', 'updatable'] },
    { name: 'price', data_type: 'numeric', format: 'numeric(12,2)', options: ['nullable', 'updatable'] },
    { name: 'quantity', data_type: 'integer', options: ['nullable', 'updatable'] },
    { name: 'active', data_type: 'boolean', options: ['nullable', 'updatable'] },
    { name: 'released_on', data_type: 'date', format: 'date', options: ['nullable', 'updatable'] },
    { name: 'branchid', data_type: 'uuid', format: 'uuid', options: ['nullable', 'updatable'] },
    { name: 'note', data_type: 'text', options: ['nullable', 'updatable'] },
    { name: 'created_at', data_type: 'timestamp with time zone', format: 'timestamp with time zone', options: ['updatable'], default_value: 'now()' },
    { name: 'updated_at', data_type: 'timestamp with time zone', format: 'timestamp with time zone', options: ['updatable'], default_value: "timezone('utc'::text, now())" },
    { name: 'display_name', data_type: 'text', options: ['generated', 'nullable', 'updatable'], default_value: 'x' },
    { name: 'formula_total', data_type: 'numeric', options: ['nullable', 'updatable'] },
    { name: 'lookup_branch', data_type: 'text', options: ['nullable', 'updatable'] },
  ],
};

const productsRow = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Sữa',
  price: '1250.50',
  quantity: 3,
  active: true,
  released_on: '2026-01-02',
  branchid: '00000000-0000-0000-0000-000000000002',
  note: null,
  created_at: '2020-01-01T00:00:00+00:00',
  updated_at: '2020-01-02T00:00:00+00:00',
  display_name: 'Chi nhánh - Sữa',
  formula_total: '999',
  lookup_branch: 'Chi nhánh 1',
};

const newTimestamp = '2026-11-02T12:34:56+00:00';

type Column = {
  name: string;
  data_type: string;
  format?: string;
  options: string[];
  default_value?: string;
  identity_generation?: string;
  enum_values?: string[];
};

type Table = {
  name: string;
  primary_keys: string[];
  unique_constraints: Array<{ name: string; columns: string[] }>;
  foreign_key_constraints: Array<Record<string, unknown>>;
  columns: Column[];
};

type Row = Record<string, unknown>;

type Mock = {
  table: Table;
  rows: Row[];
  posts: Array<{ values: Record<string, unknown> }>;
  patches: number;
  gets: URLSearchParams[];
  lookups: Array<{ column: string; values: string[] }>;
  formulaItems?: Array<Record<string, unknown>>;
  lookupItems?: Array<Record<string, unknown>>;
  onPost: (
    route: Route,
    body: { values: Record<string, unknown> },
    mock: Mock,
  ) => Promise<void> | void;
};

async function mockApi(page: Page, overrides: Partial<Mock> = {}) {
  const mock: Mock = {
    table: productsTable,
    rows: [productsRow],
    posts: [],
    patches: 0,
    gets: [],
    lookups: [],
    formulaItems: [
      { table: 'products', column: 'formula_total', enabled: true },
    ],
    lookupItems: [
      {
        id: 'lookup-1',
        sourceTable: 'products',
        targetTable: 'branches',
        columnBound: true,
        sync: { enabled: true, columnName: 'lookup_branch' },
      },
    ],
    onPost: async (route, body) => {
      const created: Row = {
        ...body.values,
        id: `00000000-0000-0000-0000-${String(900000000000 + mock.posts.length)}`,
      };
      if (mock.table.columns.some((column) => column.name === 'created_at'))
        created.created_at = newTimestamp;
      if (mock.table.columns.some((column) => column.name === 'updated_at'))
        created.updated_at = newTimestamp;
      if (mock.table.columns.some((column) => column.name === 'display_name'))
        created.display_name = `Generated - ${body.values.name}`;
      if (mock.table.columns.some((column) => column.name === 'formula_total'))
        created.formula_total = '3750.00';
      mock.rows = [...mock.rows, created];
      await route.fulfill({ json: { rows: [mock.rows.at(-1)] } });
    },
    ...overrides,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [mock.table],
          token: 'csrf',
          adminAvailable: true,
          definitions: [],
        },
      });
    if (path === '/api/formula-config')
      return route.fulfill({ json: { items: mock.formulaItems || [] } });
    if (path === '/api/lookup-config')
      return route.fulfill({
        json: { available: true, items: mock.lookupItems || [] },
      });
    if (path === '/api/lookup-config/cleanup-disabled')
      return route.fulfill({ json: { removed: 0 } });
    const tableName = mock.table.name.replace(/^public\./, '');
    if (path === `/api/lookup/${tableName}` && request.method() === 'POST') {
      const body = request.postDataJSON();
      mock.lookups.push(body);
      const wanted = new Set((body.values || []).map(String));
      return route.fulfill({
        json: {
          rows: mock.rows.filter((row) =>
            wanted.has(String(row[body.column])),
          ),
        },
      });
    }
    if (path === `/api/table/${tableName}`) {
      if (request.method() === 'GET') {
        mock.gets.push(url.searchParams);
        return route.fulfill({
          json: { rows: mock.rows, total: mock.rows.length },
        });
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        mock.posts.push(body);
        return mock.onPost(route, body, mock);
      }
      if (request.method() === 'PATCH') {
        mock.patches++;
        return route.fulfill({ json: { rows: [mock.rows[0]] } });
      }
    }
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  return mock;
}

async function openFirstRecord(page: Page) {
  await page.goto('/');
  await expect(page.locator('td.record-detail').first()).toBeVisible();
  await page.locator('td.record-detail').first().click();
  await expect(page.locator('#editor')).toBeVisible();
}

test('nhân bản ngay với ID tự sinh, giữ kiểu dữ liệu và cập nhật bảng ngầm', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'siris-views-v1',
      JSON.stringify({
        products: {
          filters: [{ column: 'active', operator: 'equals', value: 'true' }],
          sorts: [{ column: 'name', direction: 'asc' }],
          order: [],
          hidden: [],
          frozen: ['col:name'],
          widths: {},
          search: '',
          page: 0,
          freezeDefaultInitialized: true,
        },
      }),
    );
  });
  const mock = await mockApi(page);
  await openFirstRecord(page);
  const originalCell = page.locator('td[data-bulk-column="name"]').first();
  await expect(originalCell).toHaveText('Sữa');

  await page.locator('#duplicate').click();

  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].values).toEqual({
    name: 'Sữa',
    price: '1250.50',
    quantity: 3,
    active: true,
    released_on: '2026-01-02',
    branchid: '00000000-0000-0000-0000-000000000002',
    note: null,
  });
  expect(mock.posts[0].values.id).toBeUndefined();
  expect(mock.posts[0].values.created_at).toBeUndefined();
  expect(mock.posts[0].values.updated_at).toBeUndefined();
  expect(mock.posts[0].values.display_name).toBeUndefined();
  expect(mock.posts[0].values.formula_total).toBeUndefined();
  expect(mock.posts[0].values.lookup_branch).toBeUndefined();
  expect(mock.patches).toBe(0);

  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(2);
  await expect(originalCell).toHaveText('Sữa');
  await expect(page.locator('td[data-bulk-column="name"]').nth(1)).toHaveText(
    'Sữa',
  );
  await expect(page.locator('td[data-bulk-column="note"]').nth(1)).toHaveText(
    '—',
  );
  await expect(
    page.locator('td[data-bulk-column="created_at"]').nth(1),
  ).toHaveText(newTimestamp);
  await expect(
    page.locator('td[data-bulk-column="updated_at"]').nth(1),
  ).toHaveText(newTimestamp);
  await expect(
    page.locator('td[data-bulk-column="display_name"]').nth(1),
  ).toHaveText('Generated - Sữa');
  await expect(
    page.locator('td[data-bulk-column="formula_total"]').nth(1),
  ).toHaveText('3,750.00');
  await expect(
    page.locator('td[data-bulk-column="created_at"]').first(),
  ).toHaveText('2020-01-01T00:00:00+00:00');
  await expect(
    page.locator('td[data-bulk-column="display_name"]').first(),
  ).toHaveText('Chi nhánh - Sữa');

  const lastGet = mock.gets.at(-1)!;
  expect(JSON.parse(lastGet.get('filters') || '[]')).toEqual([
    { column: 'active', operator: 'equals', value: 'true' },
  ]);
  expect(JSON.parse(lastGet.get('orders') || '[]')).toEqual([
    { column: 'name', direction: 'asc' },
  ]);
});

test('dấu ... trên bảng nhân bản nhanh mà không mở chi tiết', async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto('/');
  const quick = page.locator('td.record-detail .record-duplicate').first();
  await expect(quick).toBeVisible();
  await expect(quick).toHaveAttribute('title', 'Nhân bản nhanh');

  await quick.click();

  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].values.name).toBe('Sữa');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(2);
  await expect(page.locator('td[data-bulk-column="name"]').nth(1)).toHaveText(
    'Sữa',
  );
});

test('khóa chính nhập tay mở form với dữ liệu đã sao chép và đánh dấu trường cần sửa', async ({
  page,
}) => {
  const table = {
    name: 'public.manual_products',
    primary_keys: ['id'],
    unique_constraints: [],
    foreign_key_constraints: [],
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['nullable', 'updatable'] },
      { name: 'price', data_type: 'numeric', options: ['nullable', 'updatable'] },
    ],
  };
  const mock = await mockApi(page, {
    table,
    rows: [{ id: 1, name: 'Máy', price: '10.00' }],
  });
  await openFirstRecord(page);

  await page.locator('#duplicate').click();

  expect(mock.posts).toHaveLength(0);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#dialogTitle')).toHaveText('Nhân bản bản ghi');
  await expect(page.locator('#formError')).toContainText('cần bổ sung');
  await expect(page.locator('#field-name')).toHaveValue('Máy');
  await expect(page.locator('#field-price')).toHaveValue('10.00');
  await expect(page.locator('#field-id')).toHaveValue('');
  await expect(page.locator('#field-id')).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.locator('#field-id').locator('xpath=ancestor::div[contains(@class,"field")]').locator('.field-note'),
  ).toContainText('Khóa chính');

  await page.locator('#field-id').fill('2');
  await page.locator('#save').click();

  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].values).toEqual({ id: 2, name: 'Máy', price: '10.00' });
  await expect(page.locator('#editor')).toBeHidden();
});

test('trường unique văn bản tự thêm copy, copy 2; name không unique giữ nguyên', async ({
  page,
}) => {
  const table = {
    ...productsTable,
    unique_constraints: [{ name: 'products_sku_key', columns: ['sku'] }],
    columns: [
      ...productsTable.columns,
      { name: 'sku', data_type: 'text', options: ['nullable', 'updatable'] },
    ],
  };
  const mock = await mockApi(page, {
    table,
    rows: [{ ...productsRow, sku: 'SKU-1' }],
  });
  await page.goto('/');
  const quick = page.locator('td.record-detail .record-duplicate').first();
  await expect(quick).toBeVisible();

  await quick.click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].values.sku).toBe('SKU-1 copy');
  expect(mock.posts[0].values.name).toBe('Sữa');
  expect(mock.lookups[0].column).toBe('sku');
  expect(mock.lookups[0].values).toContain('SKU-1 copy');
  await expect(
    page.locator('td[data-bulk-column="sku"]').first(),
  ).toHaveText('SKU-1');

  await page.locator('td.record-detail .record-duplicate').first().click();
  await expect.poll(() => mock.posts.length).toBe(2);
  expect(mock.posts[1].values.sku).toBe('SKU-1 copy 2');
  expect(mock.posts[1].values.name).toBe('Sữa');
  await expect(
    page.locator('td[data-bulk-column="sku"]').first(),
  ).toHaveText('SKU-1');
});

test('unique nhiều cột chỉ đổi một trường văn bản và giữ khóa ngoại', async ({
  page,
}) => {
  const branch = '00000000-0000-0000-0000-000000000002';
  const table = {
    name: 'public.products',
    primary_keys: ['id'],
    unique_constraints: [
      { name: 'products_code_branch_key', columns: ['code', 'branchid'] },
    ],
    foreign_key_constraints: [],
    columns: [
      { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], default_value: 'gen_random_uuid()' },
      { name: 'name', data_type: 'text', options: ['nullable', 'updatable'] },
      { name: 'code', data_type: 'text', options: ['updatable'] },
      { name: 'branchid', data_type: 'uuid', format: 'uuid', options: ['updatable'] },
      { name: 'price', data_type: 'numeric', options: ['nullable', 'updatable'] },
    ],
  };
  const mock = await mockApi(page, {
    table,
    rows: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Sữa',
        code: 'A',
        branchid: branch,
        price: '1250.50',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Khác',
        code: 'A copy',
        branchid: branch,
        price: '1.00',
      },
    ],
  });
  await page.goto('/');
  await page.locator('td.record-detail .record-duplicate').first().click();

  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].values).toEqual({
    name: 'Sữa',
    code: 'A copy 2',
    branchid: branch,
    price: '1250.50',
  });
});

test('unique không thể thêm hậu tố mở form và chỉ rõ trường cần sửa', async ({
  page,
}) => {
  const table = {
    ...productsTable,
    unique_constraints: [{ name: 'products_email_key', columns: ['email'] }],
    columns: [
      ...productsTable.columns,
      { name: 'email', data_type: 'text', options: ['nullable', 'updatable'] },
    ],
  };
  const mock = await mockApi(page, {
    table,
    rows: [{ ...productsRow, email: 'a@example.com' }],
  });
  await page.goto('/');
  await page.locator('td.record-detail .record-duplicate').first().click();

  expect(mock.posts).toHaveLength(0);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#field-email')).toHaveValue('a@example.com');
  await expect(page.locator('#field-email')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.locator('#formError')).toContainText('cần bổ sung');
});

test('lỗi unique từ database mở lại form, giữ bản nháp và chỉ rõ trường', async ({
  page,
}) => {
  const table = {
    ...productsTable,
    unique_constraints: [{ name: 'products_name_key', columns: ['name'] }],
  };
  const mock = await mockApi(page, {
    table,
    onPost: async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          error:
            'duplicate key value violates unique constraint "products_name_key"',
        },
      });
    },
  });
  await openFirstRecord(page);

  await page.locator('#duplicate').click();

  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#dialogTitle')).toHaveText('Nhân bản bản ghi');
  await expect(page.locator('#formError')).toContainText('duplicate key');
  await expect(page.locator('#field-name')).toHaveValue('Sữa copy');
  await expect(page.locator('#field-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#field-price')).toHaveValue('1250.50');
  expect(mock.posts).toHaveLength(1);

  await page.locator('#field-name').fill('Sữa copy 2');
  await page.locator('#save').click();

  await expect.poll(() => mock.posts.length).toBe(2);
  expect(mock.posts[1].values.name).toBe('Sữa copy 2');
});

test('lỗi mạng giữ nguyên bản nháp, báo rõ và không tự thử lại', async ({
  page,
}) => {
  const mock = await mockApi(page, {
    onPost: async (route) => {
      await route.abort('failed');
    },
  });
  await openFirstRecord(page);

  await page.locator('#duplicate').click();

  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#formError')).toContainText('Không thể xác nhận');
  await expect(page.locator('#formError')).toContainText('Dữ liệu nháp');
  await expect(page.locator('#field-name')).toHaveValue('Sữa');
  await expect(page.locator('#field-price')).toHaveValue('1250.50');
  await expect(page.locator('#field-note')).toHaveValue('');
  await page.waitForTimeout(250);
  expect(mock.posts).toHaveLength(1);
});

test('bấm liên tiếp chỉ tạo một dòng', async ({ page }) => {
  const mock = await mockApi(page, {
    onPost: async (route, body, state) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      state.rows = [
        ...state.rows,
        { ...body.values, id: '00000000-0000-0000-0000-000000000098' },
      ];
      await route.fulfill({ json: { rows: [state.rows.at(-1)] } });
    },
  });
  await openFirstRecord(page);

  await page.locator('#duplicate').evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(2);
  expect(mock.posts).toHaveLength(1);
});

test('cập nhật ngầm giữ vị trí cuộn của bảng', async ({ page }) => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    ...productsRow,
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    name: `Sản phẩm ${String(index + 1).padStart(2, '0')}`,
  }));
  const mock = await mockApi(page, { rows });
  await openFirstRecord(page);

  const scroller = page.locator('.table-scroll');
  await scroller.evaluate((element) => {
    element.scrollTop = 300;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(300);

  await page.locator('#duplicate').click();

  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(41);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
});
