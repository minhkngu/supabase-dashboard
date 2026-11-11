import { test, expect } from '@playwright/test';

test('mở bảng trực tiếp và giữ thiết lập cột', async ({ page }) => {
  let name = 'Mia';
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: false,
        },
      });
      return;
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      if (body.expected && body.expected.name !== name) {
        await route.fulfill({ status: 409, json: { error: 'Bản ghi đã thay đổi' } });
        return;
      }
      name = body.values.name;
      await route.fulfill({ json: { rows: [{ id: 1, name }] } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, name }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('tbody')).toContainText('1');
  await page.locator('td.cell-editable').filter({ hasText: 'Mia' }).click();
  await page.locator('td.editing input').fill('Lune');
  await page.locator('td.editing input').press('Enter');
  await expect(page.locator('tbody')).toContainText('Lune');
  await page.locator('#undoCell').click();
  await expect(page.locator('tbody')).toContainText('Mia');
  await page.locator('#redoCell').click();
  await expect(page.locator('tbody')).toContainText('Lune');
  await page.locator('#undoCell').click();
  await expect(page.locator('tbody')).toContainText('Mia');
  await page.locator('#columnsButton').click();
  await page.locator('#columnVisibility label').filter({ hasText: 'name' }).click();
  await expect(page.locator('thead')).not.toContainText('name');
  await page.reload();
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('thead')).not.toContainText('name');
});

test('bảng không có khóa chính chỉ đọc', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.report',
              columns: [{ name: 'description', data_type: 'text', options: ['updatable'] }],
              primary_keys: [],
            },
          ],
          token: 'csrf',
          adminAvailable: false,
        },
      });
      return;
    }
    await route.fulfill({ json: { rows: [{ description: 'Báo cáo' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('report');
  await expect(page.locator('#add')).toBeDisabled();
  await expect(page.locator('td.cell-readonly')).toContainText('Báo cáo');
});

test('không phục vụ tệp cấu hình môi trường', async ({ request }) => {
  const response = await request.get('/.env.local');
  expect(response.status()).toBeGreaterThanOrEqual(400);
});

test('giữ cấu hình bảng và dữ liệu view cũ khi bỏ nhiều view', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { hidden: ['col:name'] } }));
    localStorage.setItem(
      'siris-named-views-v1',
      JSON.stringify({ demo: { active: 'custom', items: [{ id: 'custom', name: 'Cũ', config: {} }] } }),
    );
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('thead')).not.toContainText('name');
  await expect(page.locator('#viewSelect')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('siris-named-views-v1'))).toContain('custom');
});

test('sửa nhiều ô trực tiếp trên bảng đang nhóm, báo lỗi từng dòng', async ({ page }) => {
  const rows = [
    { id: 1, name: 'Mia', category: 'A' },
    { id: 2, name: 'Lune', category: 'A' },
  ];
  await page.addInitScript(() =>
    localStorage.setItem(
      'siris-views-v1',
      JSON.stringify({ demo: { groups: [{ column: 'category', direction: 'asc' }] } }),
    ),
  );
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'category', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      if (body.key.id === 2) {
        await route.fulfill({ status: 409, json: { error: 'Xung đột' } });
        return;
      }
      Object.assign(rows[0], body.values);
      await route.fulfill({ json: { rows: [rows[0]] } });
      return;
    }
    await route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  await expect(page.locator('.group-label')).toHaveText('A');
  const first = page.locator('td[data-bulk-column="name"]').nth(0),
    second = page.locator('td[data-bulk-column="name"]').nth(1);
  await first.click({ modifiers: ['Shift'] });
  await second.click({ modifiers: ['Shift'] });
  await expect(page.locator('#bulkLabel')).toHaveText('name · 2 ô');
  await page.locator('#bulkValue').fill('Mới');
  await page.locator('#bulkApply').click();
  await expect(page.locator('#bulkError')).toContainText('Dòng 2: Xung đột');
  await expect(page.locator('#bulkApply')).toBeDisabled();
  expect(rows[0].name).toBe('Mới');
  expect(rows[1].name).toBe('Lune');
  await page.locator('#bulkCancel').click();
  await expect(page.locator('#bulkBar')).toBeHidden();
  await expect(page.locator('#gridToggle')).toHaveCount(0);
});

test('dán dữ liệu trực tiếp vào bảng', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } })),
  );
  const rows = [
    { id: 1, name: 'Mia', count: 1 },
    { id: 2, name: 'Lune', count: 2 },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'count', data_type: 'integer', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      const row = rows.find(x => x.id === body.key.id)!;
      Object.assign(row, body.values);
      await route.fulfill({ json: { rows: [row] } });
      return;
    }
    await route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  await expect(page.locator('tbody')).toContainText('Mia');
  await page
    .locator('td[data-bulk-column="name"]')
    .first()
    .evaluate(el => {
      const data = new DataTransfer();
      data.setData('text/plain', 'A\t3\nB\t4');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
  await expect.poll(() => rows[1].name).toBe('B');
  expect(rows).toEqual([
    { id: 1, name: 'A', count: 3 },
    { id: 2, name: 'B', count: 4 },
  ]);
});

test('sửa hàng loạt số thập phân không làm tròn giá trị nhập', async ({ page }) => {
  const rows = [
    { id: 1, price: 10 },
    { id: 2, price: 20 },
  ];
  const values: string[] = [];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'price', data_type: 'numeric', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      values.push(body.values.price);
      await route.fulfill({ json: { rows: [{ ...rows[body.key.id - 1], ...body.values }] } });
      return;
    }
    await route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  await expect(page.locator('tbody')).toContainText('10');
  const cells = page.locator('td[data-bulk-column="price"]');
  await cells.nth(0).click({ modifiers: ['Shift'] });
  await cells.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('#bulkValue').fill('123456789012345678.25');
  await page.locator('#bulkApply').click();
  await expect.poll(() => values.length).toBe(2);
  expect(values).toEqual(['123456789012345678.25', '123456789012345678.25']);
});

test('sửa số lớn và thập phân chính xác, từ chối số nguyên sai', async ({ page }) => {
  const row = { id: 1, amount: '1', big: '2', count: 3 };
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'amount', data_type: 'numeric', options: ['updatable'] },
                { name: 'big', data_type: 'bigint', options: ['updatable'] },
                { name: 'count', data_type: 'integer', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      writes.push(body.values);
      Object.assign(row, body.values);
      await route.fulfill({ json: { rows: [row] } });
      return;
    }
    await route.fulfill({ json: { rows: [row], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="amount"]')).toHaveText('1');
  await page.locator('td[data-bulk-column="amount"]').click();
  await page.locator('td.editing input').fill('123456789012345678.25');
  await page.locator('td.editing input').press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ amount: '123456789012345678.25' });
  await page.locator('td[data-bulk-column="big"]').click();
  await page.locator('td.editing input').fill('9223372036854775807');
  await page.locator('td.editing input').press('Enter');
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ big: '9223372036854775807' });
  await page.locator('td[data-bulk-column="count"]').click();
  await page.locator('td.editing input').fill('1.5');
  await page.locator('td.editing input').press('Enter');
  await expect(page.locator('#toast')).toContainText('số hợp lệ');
  expect(writes.length).toBe(2);
});

test('liên kết khóa ngoại báo xung đột và giữ hộp chọn', async ({ page }) => {
  const source = {
    name: 'public.rooms',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'branchid', data_type: 'integer', options: ['updatable', 'nullable'] },
    ],
    primary_keys: ['id'],
    foreign_key_constraints: [
      {
        name: 'fk_branch',
        source_table: 'public.rooms',
        source_columns: ['branchid'],
        target_table: 'public.branches',
        target_columns: ['id'],
      },
    ],
  };
  const target = {
    name: 'public.branches',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
    ],
    primary_keys: ['id'],
    foreign_key_constraints: [],
  };
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables: [source, target], token: 'csrf', adminAvailable: false } });
      return;
    }
    if (req.method() === 'PATCH') {
      body = req.postDataJSON();
      await route.fulfill({ status: 409, json: { error: 'Bản ghi đã thay đổi' } });
      return;
    }
    if (url.pathname.endsWith('/branches')) {
      await route.fulfill({ json: { rows: [{ id: 2, name: 'Chi nhánh mới' }], total: 1 } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, branchid: 1 }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="branchid"]')).toHaveText('1');
  await page.locator('td[data-bulk-column="branchid"]').click();
  await expect(page.locator('#linkPicker')).toBeVisible();
  await page.getByRole('button', { name: /Chi nhánh mới/ }).click();
  await expect(page.locator('#pickerError')).toHaveText('Bản ghi đã thay đổi');
  expect(body?.expected).toEqual({ branchid: 1 });
  expect(body?.values).toEqual({ branchid: 2 });
  await expect(page.locator('#linkPicker')).toBeVisible();
});

test('chọn và bỏ liên kết khóa ngoại', async ({ page }) => {
  const source = {
    name: 'public.rooms',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'branchid', data_type: 'integer', options: ['updatable', 'nullable'] },
    ],
    primary_keys: ['id'],
    foreign_key_constraints: [
      {
        name: 'fk_branch',
        source_table: 'public.rooms',
        source_columns: ['branchid'],
        target_table: 'public.branches',
        target_columns: ['id'],
      },
    ],
  };
  const target = {
    name: 'public.branches',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
    ],
    primary_keys: ['id'],
  };
  const row: { id: number; branchid: number | null } = { id: 1, branchid: 1 };
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables: [source, target], token: 'csrf' } });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      if (body.expected.branchid !== row.branchid) {
        await route.fulfill({ status: 409, json: { error: 'Xung đột' } });
        return;
      }
      row.branchid = body.values.branchid;
      await route.fulfill({ json: { rows: [row] } });
      return;
    }
    if (url.pathname.endsWith('/branches')) {
      await route.fulfill({ json: { rows: [{ id: 2, name: 'Chi nhánh mới' }], total: 1 } });
      return;
    }
    await route.fulfill({ json: { rows: [row], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="branchid"]')).toHaveText('1');
  await page.locator('td[data-bulk-column="branchid"]').click();
  await page.getByRole('button', { name: /Chi nhánh mới/ }).click();
  // Foreign keys show the linked record's name by default; the key stays in the title.
  await expect(page.locator('td[data-bulk-column="branchid"]')).toHaveText('Chi nhánh mới');
  await expect(page.locator('td[data-bulk-column="branchid"]')).toHaveAttribute('title', '2');
  await page.locator('td[data-bulk-column="branchid"]').click();
  await page.locator('#pickerClear').click();
  await expect(page.locator('td[data-bulk-column="branchid"]')).toHaveText('—');
  expect(row.branchid).toBeNull();
});

test('lookup tải một lần cho cả trang và nhận biết bản ghi trùng', async ({ page }) => {
  const tables = [
    {
      name: 'public.rooms',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branchid', data_type: 'integer', options: ['updatable', 'nullable'] },
      ],
      primary_keys: ['id'],
    },
    {
      name: 'public.branches',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'name', data_type: 'text', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
  ];
  let calls = 0;
  await page.addInitScript(() =>
    localStorage.setItem(
      'siris-lookups-v1',
      JSON.stringify([
        {
          id: 'test',
          sourceTable: 'rooms',
          sourceColumn: 'branchid',
          targetTable: 'branches',
          targetKey: 'id',
          targetField: 'name',
          label: 'Tên chi nhánh',
        },
      ]),
    ),
  );
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables, token: 'csrf' } });
      return;
    }
    if (url.pathname === '/api/lookup/branches') {
      calls++;
      expect(req.postDataJSON()).toEqual({ column: 'id', values: [1, 2, 3] });
      await route.fulfill({
        json: {
          rows: [
            { id: 1, name: 'Mia' },
            { id: 2, name: 'Lune' },
            { id: 2, name: 'Trùng' },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        rows: [
          { id: 1, branchid: 1 },
          { id: 2, branchid: 2 },
          { id: 3, branchid: 3 },
          { id: 4, branchid: null },
        ],
        total: 4,
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('td.lookup-cell').nth(0)).toContainText('Mia');
  await expect(page.locator('td.lookup-cell').nth(1)).toContainText('Lune');
  await expect(page.locator('td.lookup-cell').nth(1)).toContainText('Trùng');
  await expect(page.locator('td.lookup-cell').nth(2)).toHaveText('—');
  await expect(page.locator('td.lookup-cell').nth(3)).toHaveText('—');
  expect(calls).toBe(1);
});

test('lookup cũ từ khóa ngoại vẫn hiển thị sau tải lại', async ({ page }) => {
  const source = {
    name: 'public.rooms',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'branchid', data_type: 'integer', options: ['updatable'] },
    ],
    primary_keys: ['id'],
    foreign_key_constraints: [
      {
        name: 'fk_branch',
        source_table: 'public.rooms',
        source_columns: ['branchid'],
        target_table: 'public.branches',
        target_columns: ['id'],
      },
    ],
  };
  const target = {
    name: 'public.branches',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
    ],
    primary_keys: ['id'],
  };
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables: [source, target], token: 'csrf', adminAvailable: false } });
      return;
    }
    if (url.pathname === '/api/lookup/branches') {
      await route.fulfill({ json: { rows: [{ id: 2, name: 'Siris' }] } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, branchid: 2 }], total: 1 } });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      'siris-lookups-v1',
      JSON.stringify([
        {
          id: 'test',
          sourceTable: 'rooms',
          sourceColumn: 'branchid',
          targetTable: 'branches',
          targetKey: 'id',
          targetField: 'name',
          label: 'Tên chi nhánh',
        },
      ]),
    ),
  );
  await page.goto('/');
  await expect(page.locator('td.lookup-cell')).toContainText('Siris');
  await page.reload();
  await expect(page.locator('td.lookup-cell')).toContainText('Siris');
});

test('lookup nhiều điều kiện tất cả hoặc bất kỳ và định dạng số', async ({ page }) => {
  const tables = [
    {
      name: 'public.rooms',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branch', data_type: 'text', options: ['updatable'] },
        { name: 'kind', data_type: 'text', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
    {
      name: 'public.prices',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branch', data_type: 'text', options: ['updatable'] },
        { name: 'kind', data_type: 'text', options: ['updatable'] },
        { name: 'price', data_type: 'numeric', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables, token: 'csrf' } });
      return;
    }
    if (url.pathname === '/api/lookup/prices') {
      const column = req.postDataJSON().column;
      const rows =
        column === 'branch'
          ? [
              { id: 1, branch: 'Mia', kind: 'Studio', price: 1200000 },
              { id: 2, branch: 'Mia', kind: 'Deluxe', price: 2000000 },
            ]
          : [
              { id: 1, branch: 'Mia', kind: 'Studio', price: 1200000 },
              { id: 3, branch: 'Lune', kind: 'Studio', price: 3000000 },
            ];
      await route.fulfill({ json: { rows } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, branch: 'Mia', kind: 'Studio' }], total: 1 } });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('siris-lookups-v1'))
      localStorage.setItem(
        'siris-lookups-v1',
        JSON.stringify([
          {
            id: 'test',
            sourceTable: 'rooms',
            sourceColumn: 'branch',
            targetKey: 'branch',
            targetTable: 'prices',
            targetField: 'price',
            label: 'Giá',
            conditions: [
              { sourceColumn: 'branch', targetKey: 'branch' },
              { sourceColumn: 'kind', targetKey: 'kind' },
            ],
            mode: 'all',
            display: 'value',
            format: 'grouped',
          },
        ]),
      );
  });
  await page.goto('/');
  await expect(page.locator('td.lookup-cell')).toHaveText('1,200,000');
  await page.evaluate(() => {
    const configs = JSON.parse(localStorage.getItem('siris-lookups-v1') || '[]');
    configs[0].mode = 'any';
    configs[0].display = 'count';
    localStorage.setItem('siris-lookups-v1', JSON.stringify(configs));
  });
  await page.reload();
  await expect(page.locator('td.lookup-cell')).toHaveText('3');
});

test('lookup trong cột gửi cấu hình nhiều điều kiện đến server', async ({ page }) => {
  const column = (name: string, data_type: string) => ({
    name,
    data_type,
    format: data_type,
    options: ['updatable', 'nullable'],
  });
  const tables = [
    {
      name: 'public.rooms',
      columns: [column('id', 'integer'), column('branch', 'text'), column('kind', 'text'), column('value', 'text')],
      primary_keys: ['id'],
    },
    {
      name: 'public.branches',
      columns: [column('id', 'integer'), column('branch', 'text'), column('kind', 'text'), column('name', 'text')],
      primary_keys: ['id'],
    },
  ];
  let saved: Record<string, unknown> | undefined;
  let preview: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta') return route.fulfill({ json: { tables, token: 'csrf', adminAvailable: true } });
    if (path === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (path === '/api/lookup-config' && req.method() === 'GET')
      return route.fulfill({ json: { available: true, items: [] } });
    if (path === '/api/lookup-sync/preview') {
      preview = req.postDataJSON();
      return route.fulfill({ json: { signature: 'preview-token', affected: 1 } });
    }
    if (path === '/api/lookup-config') {
      saved = req.postDataJSON().config;
      return route.fulfill({ json: { ok: true, config: saved } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, branch: 'Mia', kind: 'Studio', value: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Thiết lập cột value' }).click();
  await page.locator('#columnSyncEnabled').check();
  await page.locator('#columnSyncTable').selectOption('branches');
  await page.locator('#columnSyncField').selectOption('name');
  await page.locator('#columnSyncConditions select').nth(0).selectOption('branch');
  await page.locator('#columnSyncConditions select').nth(1).selectOption('branch');
  await page.locator('#columnSyncAddCondition').click();
  await page.locator('#columnSyncConditions select').nth(2).selectOption('kind');
  await page.locator('#columnSyncConditions select').nth(3).selectOption('kind');
  await page.locator('#columnSyncMode').selectOption('any');
  await page.locator('#saveColumn').click();
  await expect.poll(() => saved).toBeDefined();
  expect(saved).toMatchObject({
    sourceTable: 'rooms',
    targetTable: 'branches',
    targetField: 'name',
    mode: 'any',
    conditions: [
      { sourceColumn: 'branch', targetKey: 'branch' },
      { sourceColumn: 'kind', targetKey: 'kind' },
    ],
    sync: { enabled: true, columnName: 'value' },
  });
  expect(preview).toMatchObject(saved!);
});

test('lookup báo lỗi preview và giữ thiết lập khi chưa lưu', async ({ page }) => {
  const column = (name: string, data_type: string) => ({
    name,
    data_type,
    format: data_type,
    options: ['updatable', 'nullable'],
  });
  let writes = 0;
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.rooms',
              columns: [column('id', 'integer'), column('branchid', 'integer'), column('branch_name', 'text')],
              primary_keys: ['id'],
            },
            {
              name: 'public.branches',
              columns: [column('id', 'integer'), column('name', 'text')],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (path === '/api/lookup-config' && req.method() === 'GET')
      return route.fulfill({ json: { available: true, items: [] } });
    if (path === '/api/lookup-sync/preview')
      return route.fulfill({ status: 400, json: { error: 'Không thể kiểm tra lookup' } });
    if (path === '/api/lookup-config') {
      writes++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, branchid: 2, branch_name: null }], total: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Thiết lập cột branch_name' }).click();
  await page.locator('#columnSyncEnabled').check();
  await page.locator('#columnSyncTable').selectOption('branches');
  await page.locator('#columnSyncField').selectOption('name');
  await page.locator('#columnSyncConditions select').nth(0).selectOption('branchid');
  await page.locator('#columnSyncConditions select').nth(1).selectOption('id');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnError')).toContainText('Không thể kiểm tra lookup');
  await expect(page.locator('#columnDialog')).toBeVisible();
  expect(writes).toBe(0);
});

test('quản lý cột lưu sau khi kiểm tra mà không hỏi lại', async ({ page }) => {
  let changed = false,
    previewCount = 0,
    applyCount = 0;
  const metadata = () => ({
    tables: [
      {
        name: 'public.demo',
        columns: [
          { name: 'id', data_type: 'integer', options: ['updatable'] },
          { name: changed ? 'memo' : 'note', data_type: 'text', options: ['updatable', 'nullable'] },
        ],
        primary_keys: ['id'],
      },
    ],
    token: 'csrf',
    adminAvailable: true,
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: metadata() });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      previewCount++;
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 2 } });
      return;
    }
    if (url.pathname === '/api/admin/schema/apply') {
      applyCount++;
      expect(req.postDataJSON().operation).toMatchObject({ action: 'rename', column: 'note', newName: 'memo' });
      changed = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, [changed ? 'memo' : 'note']: 'A' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('thead')).toContainText('note');
  await page.getByRole('button', { name: 'Thiết lập cột note' }).click();
  await page.locator('#columnName').fill('memo');
  await page.locator('#saveColumn').click();
  await expect(page.locator('thead')).toContainText('memo');
  expect(previewCount).toBe(1);
  expect(applyCount).toBe(1);
});

test('kéo chọn nhiều ô để sao chép và sửa trên bảng', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } })),
  );
  const rows = [
    { id: 1, name: 'Mia', price: 1000 },
    { id: 2, name: 'Lune', price: 2000 },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'price', data_type: 'integer', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
      return;
    }
    await route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="name"]').first()).toHaveText('Mia');
  const first = page.locator('td[data-bulk-column="name"]').nth(0),
    last = page.locator('td[data-bulk-column="price"]').nth(1),
    a = await first.boundingBox(),
    b = await last.boundingBox();
  if (!a || !b) throw Error('Không thấy ô');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#grid .bulk-selected')).toHaveCount(4);
  const copied = await last.evaluate(cell => {
    const transfer = new DataTransfer(),
      event = new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true });
    cell.focus();
    cell.dispatchEvent(event);
    return transfer.getData('text/plain');
  });
  expect(copied).toBe('Mia\t1000\nLune\t2000');
  const other = page.locator('td[data-bulk-column="name"]').nth(1),
    c = await other.boundingBox();
  if (!c) throw Error('Không thấy ô');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#bulkLabel')).toHaveText('name · 2 ô');
});

test('thêm cột mở trực tiếp hộp thoại', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [{ name: 'id', data_type: 'integer', options: ['updatable'] }],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1 }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('#manageLookups')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thêm cột', exact: true }).click();
  await expect(page.locator('#columnDialog')).toBeVisible();
  await expect(page.locator('#chooseLookup')).toHaveCount(0);
});

test('tạo cột hiển thị tùy chọn và xem trước cấu hình', async ({ page }) => {
  let preview: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [{ name: 'id', data_type: 'integer', options: ['updatable'] }],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      preview = req.postDataJSON();
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 0 } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1 }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await page.getByRole('button', { name: 'Thêm cột', exact: true }).click();
  await page.locator('#columnName').fill('code');
  await page.locator('#columnType').selectOption('uuid');
  await page.locator('#columnDefaultKind').selectOption('uuid');
  await page.locator('#columnUnique').check();
  await page.locator('#columnDescription').fill('Mã nhận diện');
  await page.locator('#saveColumn').click();
  await expect.poll(() => preview).toBeDefined();
  expect(preview).toMatchObject({
    action: 'add',
    newName: 'code',
    newType: 'uuid',
    options: { nullable: true, unique: true, identity: false, defaultKind: 'uuid', description: 'Mã nhận diện' },
  });
});

test('đổi kiểu cột đã tạo và hiển thị lỗi chuyển kiểu', async ({ page }) => {
  let apply = 0,
    fail = true;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'amount', data_type: apply ? 'integer' : 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      expect(req.postDataJSON()).toMatchObject({ action: 'type', column: 'amount', newType: 'integer' });
      if (fail) {
        await route.fulfill({ status: 400, json: { error: 'Có dữ liệu không thể chuyển sang kiểu đã chọn.' } });
        return;
      }
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 1 } });
      return;
    }
    if (url.pathname === '/api/admin/schema/apply') {
      apply++;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, amount: '123' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('thead')).toContainText('amount');
  await page.getByRole('button', { name: 'Thiết lập cột amount' }).click();
  await expect(page.locator('#columnKind')).toBeHidden();
  await page.locator('#columnType').selectOption('integer');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnError')).toContainText('không thể chuyển');
  expect(apply).toBe(0);
  fail = false;
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  await expect.poll(() => apply).toBe(1);
});

test('chọn và sao chép nhiều ô lookup nhưng không sửa lookup', async ({ page }) => {
  const tables = [
    {
      name: 'public.rooms',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branchid', data_type: 'integer', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
    {
      name: 'public.branches',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'name', data_type: 'text', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
  ];
  await page.addInitScript(() =>
    localStorage.setItem(
      'siris-lookups-v1',
      JSON.stringify([
        {
          id: 'test',
          sourceTable: 'rooms',
          sourceColumn: 'branchid',
          targetTable: 'branches',
          targetKey: 'id',
          targetField: 'name',
          label: 'Chi nhánh',
        },
      ]),
    ),
  );
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: { tables, token: 'csrf' } });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/lookup/branches') {
      await route.fulfill({
        json: {
          rows: [
            { id: 1, name: 'Mia' },
            { id: 2, name: 'Lune' },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        rows: [
          { id: 10, branchid: 1 },
          { id: 11, branchid: 2 },
        ],
        total: 2,
      },
    });
  });
  await page.goto('/');
  const cells = page.locator('td[data-bulk-virtual]');
  await expect(cells.first()).toContainText('Mia');
  const a = await cells.nth(0).boundingBox(),
    b = await cells.nth(1).boundingBox();
  if (!a || !b) throw Error('Không thấy lookup');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('td[data-bulk-virtual].bulk-selected')).toHaveCount(2);
  await expect(page.locator('#bulkBar')).toBeHidden();
  const copied = await cells.last().evaluate(cell => {
    const transfer = new DataTransfer();
    cell.focus();
    cell.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }));
    return transfer.getData('text/plain');
  });
  expect(copied).toBe('Mia\nLune');
  await cells.first().click({ modifiers: ['Shift'] });
  await cells.last().click({ modifiers: ['Shift'] });
  await expect(page.locator('td[data-bulk-virtual].bulk-selected')).toHaveCount(2);
});

test('chọn trường hiển thị cho khóa ngoại và giữ sau khi tải lại', async ({ page }) => {
  const tables = [
    {
      name: 'public.demo',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branch_id', data_type: 'integer', options: ['updatable'] },
      ],
      primary_keys: ['id'],
      foreign_key_constraints: [
        {
          name: 'demo_branch_fk',
          source_table: 'public.demo',
          source_columns: ['branch_id'],
          target_table: 'public.branches',
          target_columns: ['id'],
        },
      ],
    },
    {
      name: 'public.branches',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'name', data_type: 'text', options: ['updatable'] },
        { name: 'code', data_type: 'text', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta') return route.fulfill({ json: { tables, token: 'csrf', adminAvailable: false } });
    if (path === '/api/lookup/branches')
      return route.fulfill({ json: { rows: [{ id: 7, name: 'Mia', code: 'M-01' }] } });
    if (path === '/api/table/branches')
      return route.fulfill({ json: { rows: [{ id: 7, name: 'Mia', code: 'M-01' }], total: 1 } });
    return route.fulfill({ json: { rows: [{ id: 1, branch_id: 7 }], total: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Chọn trường hiển thị branch_id' }).click();
  await page.locator('#relationDisplayField').selectOption('name');
  await page.locator('#relationDisplayForm button[type=submit]').click();
  await expect(page.locator('td[data-bulk-column="branch_id"]')).toHaveText('Mia');
  await page.reload();
  await expect(page.locator('td[data-bulk-column="branch_id"]')).toHaveText('Mia');
  await page.locator('td[data-bulk-column="branch_id"]').click();
  await expect(page.locator('#pickerList')).toContainText('Mia');
});

test('lưu ô giữ bảng hiển thị trong lúc dữ liệu được làm mới', async ({ page }) => {
  let value = 'Mia',
    gets = 0;
  await page.route('**/api/**', async route => {
    // A formula column makes the save trigger a background refresh.
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [{ table: 'demo', column: 'total', expression: '1', enabled: true }] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'total', data_type: 'integer', options: ['nullable', 'updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (request.method() === 'PATCH') {
      value = request.postDataJSON().values.name;
      return route.fulfill({ json: { rows: [{ id: 1, name: value, total: 1 }] } });
    }
    gets++;
    if (gets > 1) await new Promise(resolve => setTimeout(resolve, 800));
    return route.fulfill({ json: { rows: [{ id: 1, name: value, total: 1 }], total: 1 } });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="name"]');
  await page.locator('td[data-bulk-column="id"]').evaluate(node => {
    (window as unknown as { unchangedCell: Element }).unchangedCell = node;
  });
  await cell.click();
  await page.locator('td.editing input').fill('Lune');
  await page.locator('td.editing input').press('Enter');
  await expect(cell).toHaveText('Lune');
  await expect(page.locator('#message')).toBeHidden();
  await expect(cell).toHaveText('Lune');
  await expect.poll(() => gets).toBeGreaterThan(1);
  await page.waitForTimeout(1000);
  expect(
    await page
      .locator('td[data-bulk-column="id"]')
      .evaluate(node => node === (window as unknown as { unchangedCell: Element }).unchangedCell),
  ).toBe(true);
});

test('lưu ô thất bại giữ giá trị đang nhập', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (request.method() === 'PATCH') return route.fulfill({ status: 409, json: { error: 'Dữ liệu đã thay đổi' } });
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await page.locator('td[data-bulk-column="name"]').click();
  const input = page.locator('td.editing input');
  await input.fill('Lune');
  await input.press('Enter');
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Lune');
  await expect(page.locator('#toast')).toContainText('Dữ liệu đã thay đổi');
});

test('Delete xóa giá trị vùng chọn, chặn cột bắt buộc và không can thiệp ô nhập', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } })),
  );
  const rows = [
    { id: 1, name: 'Mia', note: 'A', required: 'X' },
    { id: 2, name: 'Lune', note: 'B', required: 'Y' },
  ];
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable', 'nullable'] },
                { name: 'note', data_type: 'text', options: ['updatable', 'nullable'] },
                { name: 'required', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      const row = rows.find(item => item.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows, total: rows.length } });
  });
  await page.goto('/');
  const drag = async (first: string, second: string) => {
    const a = await page.locator(first).boundingBox(),
      b = await page.locator(second).boundingBox();
    if (!a || !b) throw Error('Không thấy ô');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await drag('td[data-bulk-column="name"] >> nth=0', 'td[data-bulk-column="note"] >> nth=1');
  await expect(page.locator('#grid .bulk-selected')).toHaveCount(4);
  await page.keyboard.press('Backspace');
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map(item => item.values)).toEqual([
    { name: null, note: null },
    { name: null, note: null },
  ]);
  await expect(page.locator('td[data-bulk-column="name"]').first()).toHaveText('—');
  await drag('td[data-bulk-column="note"] >> nth=0', 'td[data-bulk-column="required"] >> nth=1');
  await page.keyboard.press('Delete');
  await expect(page.locator('#toast')).toContainText('không được để trống');
  expect(writes).toHaveLength(2);
  await page.locator('#search').fill('abc');
  await page.locator('#search').press('Backspace');
  await expect(page.locator('#search')).toHaveValue('ab');
  expect(writes).toHaveLength(2);
});

test('dán nhiều dòng vào ô đang sửa và giữ cách dán văn bản thông thường', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } })),
  );
  const rows = [
    { id: 1, name: 'A', note: 'x' },
    { id: 2, name: 'B', note: 'y' },
    { id: 3, name: 'C', note: 'z' },
  ];
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable', 'nullable'] },
                { name: 'note', data_type: 'text', options: ['updatable', 'nullable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      writes.push(body);
      const row = rows.find(item => item.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows, total: rows.length } });
  });
  await page.goto('/');
  await page.locator('td[data-bulk-column="name"]').first().click();
  const input = page.locator('td.editing input');
  await input.evaluate(node => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Mia\tMột\nLune\tHai');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map(item => item.values)).toEqual([
    { name: 'Mia', note: 'Một' },
    { name: 'Lune', note: 'Hai' },
  ]);
  await expect(page.locator('td[data-bulk-column="name"]').nth(1)).toHaveText('Lune');
  await page.locator('td[data-bulk-column="name"]').last().click();
  await expect(page.locator('td.editing input')).toHaveValue('C');
  const prevented = await page.locator('td.editing input').evaluate(node => {
    const data = new DataTransfer();
    data.setData('text/plain', 'single');
    return !node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(prevented).toBe(false);
  await page.locator('td.editing input').evaluate(node => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Một\nHai');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#toast')).toContainText('vượt quá');
  expect(writes).toHaveLength(2);
});

test('tiêu đề nhóm khóa ngoại hiển thị cùng trường với ô liên kết', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'siris-views-v1',
      JSON.stringify({ demo: { groups: [{ column: 'branch_id', direction: 'asc' }] } }),
    );
    if (!localStorage.getItem('siris-relation-display-v1'))
      localStorage.setItem(
        'siris-relation-display-v1',
        JSON.stringify({ [JSON.stringify(['demo', 'native:demo_branch_fk', 'branches', 'id'])]: 'name' }),
      );
  });
  const tables = [
    {
      name: 'public.demo',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'branch_id', data_type: 'integer', options: ['updatable', 'nullable'] },
      ],
      primary_keys: ['id'],
      foreign_key_constraints: [
        {
          name: 'demo_branch_fk',
          source_table: 'public.demo',
          source_columns: ['branch_id'],
          target_table: 'public.branches',
          target_columns: ['id'],
        },
      ],
    },
    {
      name: 'public.branches',
      columns: [
        { name: 'id', data_type: 'integer', options: ['updatable'] },
        { name: 'name', data_type: 'text', options: ['updatable'] },
        { name: 'code', data_type: 'text', options: ['updatable'] },
      ],
      primary_keys: ['id'],
    },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta') return route.fulfill({ json: { tables, token: 'csrf', adminAvailable: false } });
    if (path === '/api/lookup/branches')
      return route.fulfill({
        json: {
          rows: [
            { id: 7, name: 'Mia', code: 'M-01' },
            { id: 8, name: 'Mia', code: 'M-02' },
          ],
        },
      });
    return route.fulfill({
      json: {
        rows: [
          { id: 1, branch_id: 7 },
          { id: 2, branch_id: 8 },
          { id: 3, branch_id: null },
        ],
        total: 3,
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('.group-label')).toHaveText(['Mia', 'Mia', '—']);
  await expect(page.locator('td[data-bulk-column="branch_id"]')).toHaveText(['Mia', 'Mia', '—']);
  await page.getByRole('button', { name: 'Chọn trường hiển thị branch_id' }).click();
  await page.locator('#relationDisplayField').selectOption('code');
  await page.locator('#relationDisplayForm button[type=submit]').click();
  await expect(page.locator('.group-label')).toHaveText(['M-01', 'M-02', '—']);
  await page.reload();
  await expect(page.locator('.group-label')).toHaveText(['M-01', 'M-02', '—']);
});

test('kéo sắp xếp cột trong danh sách và giữ thứ tự sau tải lại', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('siris-views-v1'))
      localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } }));
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'note', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia', note: 'A' }], total: 1 } });
  });
  await page.goto('/');
  await page.locator('#columnsButton').click();
  const item = (name: string) =>
    page
      .locator('#columnVisibility .column-visibility-item')
      .filter({ has: page.getByRole('button', { name: `Sắp xếp cột ${name}` }) });
  await item('note').dragTo(item('name'), { targetPosition: { x: 30, y: 2 } });
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:note', 'col:name']);
  await expect(item('note').locator('input')).toBeChecked();
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:note', 'col:name']);
  await page.locator('#columnsButton').click();
  await page.getByRole('button', { name: 'Sắp xếp cột name' }).press('ArrowUp');
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:name', 'col:note']);
});

test('thiết lập cột hiển thị kiểu Supabase và lý do cột được bảo vệ', async ({ page }) => {
  let previews = 0;
  const columns = [
    { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], protected: true },
    { name: 'amount', data_type: 'numeric', format: 'numeric(12,2)', options: ['updatable', 'nullable'] },
    { name: 'tags', data_type: '_text', format: 'text[]', options: ['updatable', 'nullable'] },
    {
      name: 'status',
      data_type: 'booking_status',
      format: 'booking_status',
      enum_values: ['new', 'done'],
      options: ['updatable'],
    },
    { name: 'code', data_type: 'text', format: 'text', options: ['updatable'], protected: true },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 'csrf', adminAvailable: true },
      });
    if (path === '/api/admin/schema/preview') {
      previews++;
      return route.fulfill({ json: { signature: 'a'.repeat(64), affected: 0 } });
    }
    return route.fulfill({
      json: { rows: [{ id: 'a', amount: '2.00', tags: [], status: 'new', code: 'x' }], total: 1 },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Thiết lập cột id' }).click();
  await expect(page.locator('#columnType')).toHaveValue('__current__');
  await expect(page.locator('#columnType')).toBeEnabled();
  await expect(page.locator('#columnTypeInfo')).toContainText('khóa chính');
  await expect(page.locator('#deleteColumn')).toBeDisabled();
  await page.locator('#cancelColumn').click();
  for (const [column, actual] of [
    ['amount', 'numeric(12,2)'],
    ['tags', 'text[]'],
    ['status', 'booking_status'],
  ]) {
    await page.getByRole('button', { name: `Thiết lập cột ${column}` }).click();
    await expect(page.locator('#columnType option:checked')).toContainText(actual);
    await expect(page.locator('#columnType')).toBeEnabled();
    await page.locator('#saveColumn').click();
    expect(previews).toBe(0);
    await expect(page.locator('#columnDialog')).toBeHidden();
  }
  await page.getByRole('button', { name: 'Thiết lập cột code' }).click();
  await expect(page.locator('#columnTypeInfo')).toContainText('ràng buộc');
  await expect(page.locator('#columnName')).toBeDisabled();
});

test('khóa chính chỉ đọc khi sửa nhưng có thể nhập khi thêm bản ghi', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request();
    if (new URL(request.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'text', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (request.method() !== 'GET') requests.push(request.method());
    return route.fulfill({ json: { rows: [{ id: 'a', name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  const id = page.locator('td[data-bulk-column="id"]');
  await id.click();
  await expect(id).toHaveClass(/cell-readonly/);
  await expect(page.locator('td.editing')).toHaveCount(0);
  await page.locator('tbody tr td').first().click();
  await expect(page.locator('#field-id')).toBeDisabled();
  await expect(page.locator('#field-name')).toBeEnabled();
  await page.locator('#cancel').click();
  await page.locator('#add').click();
  await expect(page.locator('#field-id')).toBeEnabled();
  expect(requests).toEqual([]);
});

test('copy vùng rồi chọn ô khác và dán bằng bàn phím', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const rows = [
    { id: 1, name: 'A', note: '' },
    { id: 2, name: 'B', note: '' },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable', 'nullable'] },
                { name: 'note', data_type: 'text', options: ['updatable', 'nullable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON(),
        row = rows.find(x => x.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  const first = page.locator('td[data-bulk-column="name"]').nth(0),
    second = page.locator('td[data-bulk-column="name"]').nth(1),
    a = await first.boundingBox(),
    b = await second.boundingBox();
  if (!a || !b) throw Error('Không thấy ô');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('A\nB');
  await page.locator('td[data-bulk-column="note"]').first().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await expect(page.locator('td[data-bulk-column="note"]')).toHaveText(['A', 'B']);
});

test('dán nhiều dòng vào cột bigint giữ nguyên giá trị lớn', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const rows = [
    { id: 1, amount: '1' },
    { id: 2, amount: '2' },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'amount', data_type: 'bigint', options: ['updatable', 'nullable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON(),
        row = rows.find(x => x.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows, total: 2 } });
  });
  await page.goto('/');
  await page.evaluate(() => navigator.clipboard.writeText('9223372036854775807\n1234567890123456789'));
  await page.locator('td[data-bulk-column="amount"]').first().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await expect.poll(() => rows.map(x => x.amount)).toEqual(['9223372036854775807', '1234567890123456789']);
});

test('thanh công cụ gọn trên màn hình lớn và nhỏ', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const search = page.locator('.toolbar-left'),
    controls = page.locator('.toolbar-right');
  let a = await search.boundingBox(),
    b = await controls.boundingBox();
  if (!a || !b) throw Error('Không thấy thanh công cụ');
  expect(Math.abs(a.y - b.y)).toBeLessThan(5);
  await page.setViewportSize({ width: 390, height: 844 });
  a = await search.boundingBox();
  b = await controls.boundingBox();
  if (!a || !b) throw Error('Không thấy thanh công cụ');
  expect(b.y).toBeGreaterThan(a.y);
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  await page.locator('#filterButton').click();
  await expect(page.locator('#filterMenu')).toBeVisible();
});

test('giá trị ô hiển thị ngay khi đang lưu và hoàn lại nếu lưu lỗi', async ({ page }) => {
  let reject = false,
    value = 'A';
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (reject) return route.fulfill({ status: 409, json: { error: 'Xung đột' } });
      value = req.postDataJSON().values.name;
      return route.fulfill({ json: { rows: [{ id: 1, name: value }] } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, name: value }], total: 1 } });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="name"]');
  await cell.click();
  await page.locator('td.editing input').fill('B');
  await page.locator('td.editing input').press('Enter');
  await expect(cell).toHaveText('B', { timeout: 400 });
  expect(value).toBe('A');
  await expect.poll(() => value).toBe('B');
  await expect(page.locator('#toast')).toContainText('Đã lưu');
  reject = true;
  await cell.click();
  await page.locator('td.editing input').fill('C');
  await page.locator('td.editing input').press('Enter');
  await expect(cell).toHaveText('C', { timeout: 400 });
  await expect(page.locator('td.editing input')).toHaveValue('C');
  await expect(page.locator('#toast')).toContainText('Xung đột');
  expect(value).toBe('B');
});

test('ẩn và hiện cột cập nhật hàng dữ liệu ngay và giữ menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'note', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({
      json: {
        rows: [
          { id: 1, name: 'Mia', note: 'A' },
          { id: 2, name: 'Lune', note: 'B' },
        ],
        total: 2,
      },
    });
  });
  await page.goto('/');
  await page.locator('#columnsButton').click();
  const menu = page.locator('#columnsMenu'),
    item = page.locator('#columnVisibility label').filter({ hasText: 'name' });
  await item.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('th[data-column-id="col:name"]')).toHaveCount(0);
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(0);
  await expect(page.locator('td[data-bulk-column="note"]')).toHaveText(['A', 'B']);
  await expect(page.locator('#hiddenColumnCount')).toHaveText('1');
  await item.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText(['Mia', 'Lune']);
  await expect(page.locator('#hiddenColumnCount')).toHaveText('');
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText(['Mia', 'Lune']);
});

test('cột name được ghim khi cuộn ngang và có thể bỏ ghim', async ({ page }) => {
  const columns = ['id', 'name', 'one', 'two', 'three', 'four', 'five', 'six'].map(column => ({
    name: column,
    data_type: column === 'id' ? 'integer' : 'text',
    options: ['updatable'],
  }));
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 'csrf' },
      });
    return route.fulfill({
      json: {
        rows: [{ id: 1, name: 'Mia', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' }],
        total: 1,
      },
    });
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  const name = page.locator('th[data-column-id="col:name"]');
  await expect(name).toHaveClass(/frozen-edge/);
  const before = await name.boundingBox();
  await page.locator('.table-scroll').evaluate(node => {
    node.scrollLeft = 500;
  });
  await expect.poll(async () => page.locator('.table-scroll').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const after = await name.boundingBox();
  if (!before || !after) throw Error('Không thấy cột');
  expect(Math.abs(before.x - after.x)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Bỏ ghim cột name' }).click();
  await expect(name).not.toHaveClass(/frozen-cell/);
  await page.reload();
  await expect(name).not.toHaveClass(/frozen-cell/);
});

test('ô chọn dòng đứng yên khi cuộn ngang lưới', async ({ page }) => {
  const columns = ['id', 'name', 'one', 'two', 'three', 'four', 'five', 'six'].map(column => ({
    name: column,
    data_type: column === 'id' ? 'integer' : 'text',
    options: ['updatable'],
  }));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (pathname === '/api/meta')
      return route.fulfill({
        json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 'csrf' },
      });
    return route.fulfill({
      json: {
        rows: [{ id: 1, name: 'Mia', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' }],
        total: 1,
      },
    });
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  const checkbox = page.locator('#grid tbody tr').first().locator('input[data-row-select]');
  await expect(checkbox).toBeVisible();
  const before = await checkbox.boundingBox();
  await page.locator('.table-scroll').evaluate(node => {
    node.scrollLeft = 500;
  });
  await expect.poll(async () => page.locator('.table-scroll').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const after = await checkbox.boundingBox();
  if (!before || !after) throw Error('Không thấy ô chọn dòng');
  expect(Math.abs(before.x - after.x)).toBeLessThan(2);
});

test('menu sửa ô đúng sai đồng bộ và lưu hoặc hủy bằng bàn phím', async ({ page }) => {
  let value: boolean | null = false;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'hidden', data_type: 'boolean', options: ['updatable', 'nullable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      value = req.postDataJSON().values.hidden;
      return route.fulfill({ json: { rows: [{ id: 1, hidden: value }] } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, hidden: value }], total: 1 } });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="hidden"]');
  await cell.click();
  const menu = page.locator('.cell-select-menu');
  await expect(menu).toBeVisible();
  await expect(cell.locator('select.cell-input')).toBeHidden();
  await expect(cell.locator('.custom-select-btn')).toHaveCount(1);
  await expect(menu).toHaveCount(1);
  await menu.getByRole('option', { name: 'true', exact: true }).click();
  await expect.poll(() => value).toBe(true);
  await expect(cell).toContainText('true');
  await cell.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(value).toBe(true);
  for (const [label, expected] of [
    ['false', false],
    ['[null]', null],
  ] as const) {
    await cell.click();
    await expect(cell.locator('select.cell-input')).toBeHidden();
    await menu.getByRole('option', { name: label, exact: true }).click();
    await expect.poll(() => value).toBe(expected);
    await expect(menu).toHaveCount(0);
  }
  await cell.click();
  await expect(menu).toBeVisible();
  await page.locator('#title').click();
  await expect(menu).toHaveCount(0);
  expect(value).toBeNull();
});

test('menu enum chỉ hiện dropdown tùy chỉnh và lưu lựa chọn', async ({ page }) => {
  let value = 'draft';
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const req = route.request();
    if (new URL(req.url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                {
                  name: 'status',
                  data_type: 'status_enum',
                  enum_values: ['draft', 'published'],
                  options: ['updatable'],
                },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (req.method() === 'PATCH') {
      value = req.postDataJSON().values.status;
      return route.fulfill({ json: { rows: [{ id: 1, status: value }] } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, status: value }], total: 1 } });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="status"]');
  await cell.click();
  await expect(cell.locator('select.cell-input')).toBeHidden();
  await expect(cell.locator('.custom-select-btn')).toHaveCount(1);
  const menu = page.locator('.cell-select-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCount(1);
  await menu.getByRole('option', { name: 'published', exact: true }).click();
  await expect.poll(() => value).toBe('published');
  await expect(cell).toContainText('published');
  await expect(menu).toHaveCount(0);
});

test('lookup toggle kiểm tra kiểu, ghi cột sẵn có và để trống khi tắt', async ({ page }) => {
  type Lookup = {
    id: string;
    label: string;
    sourceTable: string;
    targetTable: string;
    targetField: string;
    conditions: { sourceColumn: string; targetKey: string }[];
    mode: string;
    display: string;
    columnBound?: boolean;
    sync: { enabled: boolean; columnName: string };
  };
  let saved: Lookup[] = [];
  let output: string | null = 'Cũ';
  let writes = 0;
  const column = (name: string, data_type: string) => ({
    name,
    data_type,
    format: data_type,
    options: ['updatable', 'nullable'],
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.rooms',
              columns: [
                column('id', 'integer'),
                column('branchid', 'integer'),
                column('branch_name', 'text'),
                column('price', 'numeric'),
              ],
              primary_keys: ['id'],
            },
            {
              name: 'public.branches',
              columns: [column('id', 'integer'), column('name', 'text')],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/lookup-config' && req.method() === 'GET')
      return route.fulfill({ json: { available: true, items: saved } });
    if (path === '/api/lookup-sync/preview')
      return route.fulfill({
        json: {
          signature: 'preview-token',
          columnName: 'branch_name',
          affected: 1,
          dataType: 'text',
          clearing: !req.postDataJSON().sync.enabled,
        },
      });
    if (path === '/api/lookup-config') {
      const config = req.postDataJSON().config as Lookup;
      writes++;
      output = config.sync.enabled ? 'Mia' : null;
      saved = config.sync.enabled ? [config] : [];
      return route.fulfill({ json: { ok: true, config } });
    }
    if (path === '/api/table/rooms')
      return route.fulfill({ json: { rows: [{ id: 1, branchid: 2, branch_name: output, price: null }], total: 1 } });
    if (path === '/api/table/branches' || path === '/api/lookup/branches')
      return route.fulfill({ json: { rows: [{ id: 2, name: 'Mia' }], total: 1 } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Thiết lập cột price', exact: true }).click();
  await expect(page.locator('#columnSyncEnabled')).toBeVisible();
  await page.locator('#columnSyncEnabled').check();
  await expect(page.locator('#columnSyncLookup')).toHaveCount(0);
  await page.locator('#columnSyncTable').selectOption('branches');
  await page.locator('#columnSyncField').selectOption('name');
  await page.locator('#columnSyncConditions select').nth(0).selectOption('branchid');
  await page.locator('#columnSyncConditions select').nth(1).selectOption('id');
  await expect(page.locator('#columnError')).toContainText('Không khớp kiểu');
  await page.locator('#saveColumn').click();
  expect(writes).toBe(0);
  await page.locator('#cancelColumn').click();
  await page.getByRole('button', { name: 'Thiết lập cột branch_name', exact: true }).click();
  await page.locator('#columnSyncEnabled').check();
  await expect(page.locator('#columnSyncLookup')).toHaveCount(0);
  await page.locator('#columnSyncTable').selectOption('branches');
  await page.locator('#columnSyncField').selectOption('name');
  await page.locator('#columnSyncConditions select').nth(0).selectOption('branchid');
  await page.locator('#columnSyncConditions select').nth(1).selectOption('id');
  await page.locator('#saveColumn').click();
  await expect.poll(() => writes).toBe(1);
  expect(saved).toHaveLength(1);
  expect(saved[0].columnBound).toBe(true);
  await expect(page.locator('#columnDialog')).toBeHidden();
  const cell = page.locator('td[data-bulk-column="branch_name"]');
  await expect(cell).toHaveText('Mia');
  await expect(cell).toHaveClass(/cell-readonly/);
  await expect(page.locator('td[data-bulk-virtual]')).toHaveCount(0);
  await page.reload();
  await expect(cell).toHaveText('Mia');
  await page.getByRole('button', { name: 'Thiết lập cột branch_name', exact: true }).click();
  await expect(page.locator('#columnSyncEnabled')).toBeChecked();
  await expect(page.locator('#columnSyncTable')).toHaveValue('branches');
  await expect(page.locator('#columnSyncField')).toHaveValue('name');
  await page.locator('#columnSyncEnabled').uncheck();
  await page.locator('#saveColumn').click();
  await expect.poll(() => writes).toBe(2);
  await expect(page.locator('#columnDialog')).toBeHidden();
  await expect(cell).toHaveText('—');
  expect(output).toBeNull();
  await expect(page.locator('td[data-bulk-virtual]')).toHaveCount(0);
  await page.reload();
  await expect(cell).toHaveText('—');
  await expect(page.locator('td[data-bulk-virtual]')).toHaveCount(0);
});

test('menu bảng nguồn theo thứ tự và thư mục sidebar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'siris-table-order',
      JSON.stringify(['items', 'longterm_branches', 'date_adjustments', 'branches', 'rooms']),
    );
    localStorage.setItem(
      'siris-table-folders',
      JSON.stringify({
        folders: [
          { id: 'short', name: 'short-term', collapsed: false },
          { id: 'long', name: 'long-term', collapsed: true },
        ],
        tableFolders: { branches: 'short', date_adjustments: 'short', rooms: 'short', longterm_branches: 'long' },
      }),
    );
    localStorage.setItem('siris-current-table', 'rooms');
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: ['branches', 'date_adjustments', 'items', 'longterm_branches', 'rooms'].map(table => ({
            name: 'public.' + table,
            primary_keys: ['id'],
            columns: [
              { name: 'id', data_type: 'integer', options: ['updatable'] },
              { name: 'name', data_type: 'text', options: ['updatable', 'nullable'] },
            ],
          })),
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: true, items: [] } });
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Thiết lập cột name', exact: true }).click();
  await page.locator('#columnSyncEnabled').check();
  const trigger = page.getByRole('button', { name: 'Bảng nguồn lookup', exact: true });
  await trigger.click();
  const menu = trigger.locator('..').locator('.custom-select-menu');
  await expect(menu.locator('.custom-select-item-text')).toHaveText([
    'Chọn bảng nguồn',
    'date_adjustments',
    'branches',
    'longterm_branches',
    'items',
  ]);
  await expect(menu.locator('.custom-select-group')).toHaveText(['short-term', 'long-term']);
  await menu.getByRole('option', { name: 'longterm_branches', exact: true }).click();
  await expect(page.locator('#columnSyncTable')).toHaveValue('longterm_branches');
});

test('kéo chọn nhiều ô không mở thanh sửa cho tới khi thả chuột', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({
      json: {
        rows: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ],
        total: 3,
      },
    });
  });
  await page.goto('/');
  const cells = page.locator('td[data-bulk-column="name"]');
  await expect(cells).toHaveCount(3);
  const first = await cells.nth(0).boundingBox(),
    last = await cells.nth(2).boundingBox();
  if (!first || !last) throw Error('Không thấy ô');
  await page.mouse.move(first.x + 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + 15, last.y + 15, { steps: 5 });
  await expect(page.locator('#bulkBar')).toBeHidden();
  await expect(page.locator('td.bulk-selected')).toHaveCount(3);
  await page.mouse.up();
  await expect(page.locator('#bulkBar')).toBeVisible();
  await expect(page.locator('#bulkLabel')).toHaveText('name · 3 ô');
});

test('formula lưu nền, bảo vệ ô và giữ giá trị khi tắt', async ({ page }) => {
  let configs: { table: string; column: string; expression: string; enabled: boolean }[] = [];
  let value = 15;
  let fail = false;
  const col = (name: string) => ({ name, data_type: 'numeric', format: 'numeric', options: ['updatable', 'nullable'] });
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [{ name: 'public.rooms', columns: [col('id'), col('price'), col('total')], primary_keys: ['id'] }],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: true, items: [] } });
    if (path === '/api/formula-config' && req.method() === 'GET') return route.fulfill({ json: { items: configs } });
    if (path === '/api/formula-config') {
      if (fail) return route.fulfill({ status: 400, json: { error: 'Công thức không hợp lệ.' } });
      const config = req.postDataJSON();
      configs = [config];
      if (config.enabled) value = 20;
      return route.fulfill({ json: { config } });
    }
    if (path === '/api/table/rooms')
      return route.fulfill({ json: { rows: [{ id: 1, price: 10, total: value }], total: 1 } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await page.locator('#columnFormulaEnabled').check();
  await page.locator('#columnFormulaField').selectOption('price');
  await expect(page.locator('#columnFormulaExpression')).toHaveValue('[price]');
  await page.locator('#columnFormulaExpression').fill('[price] * 2');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  const cell = page.locator('td[data-bulk-column="total"]');
  await expect(cell).toHaveText('20');
  await expect(cell).toHaveClass(/cell-readonly/);
  await page.reload();
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await expect(page.locator('#columnFormulaEnabled')).toBeChecked();
  await page.locator('#columnFormulaEnabled').uncheck();
  await page.locator('#saveColumn').click();
  await expect(cell).toHaveClass(/cell-editable/);
  await expect(cell).toHaveText('20');
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await page.locator('#columnFormulaEnabled').check();
  await page.locator('#columnFormulaExpression').fill('[price] / 0');
  fail = true;
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeVisible();
  await expect(page.locator('#columnError')).toContainText('Công thức không hợp lệ');
  await expect(page.locator('#columnFormulaExpression')).toHaveValue('[price] / 0');
});

test('đổi tên cột lookup và giữ cấu hình đồng bộ', async ({ page }) => {
  const col = (name: string, data_type: string) => ({
    name,
    data_type,
    format: data_type,
    options: ['updatable', 'nullable'],
  });
  let field = 'branch_name';
  let config = {
    id: 'lookup-1',
    label: 'branch_name',
    sourceTable: 'rooms',
    targetTable: 'branches',
    targetField: 'name',
    sourceColumn: 'branchid',
    targetKey: 'id',
    conditions: [{ sourceColumn: 'branchid', targetKey: 'id' }],
    mode: 'all',
    display: 'value',
    columnBound: true,
    sync: { enabled: true, columnName: 'branch_name' },
  };
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.rooms',
              columns: [col('id', 'integer'), col('branchid', 'integer'), col(field, 'text')],
              primary_keys: ['id'],
            },
            { name: 'public.branches', columns: [col('id', 'integer'), col('name', 'text')], primary_keys: ['id'] },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: true, items: [config] } });
    if (path === '/api/lookup-sync/rename') {
      const body = req.postDataJSON();
      field = body.newName;
      config = { ...config, label: field, sync: { enabled: true, columnName: field } };
      return route.fulfill({ json: { config } });
    }
    if (path === '/api/table/rooms')
      return route.fulfill({ json: { rows: [{ id: 1, branchid: 2, [field]: 'Mia' }], total: 1 } });
    return route.fulfill({ json: { rows: [{ id: 2, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Thiết lập cột branch_name', exact: true }).click();
  await expect(page.locator('#columnSyncEnabled')).toBeChecked();
  await page.locator('#columnName').fill('ten_chi_nhanh');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  await expect(page.locator('td[data-bulk-column="ten_chi_nhanh"]')).toHaveText('Mia');
  await page.getByRole('button', { name: 'Thiết lập cột ten_chi_nhanh', exact: true }).click();
  await expect(page.locator('#columnSyncEnabled')).toBeChecked();
});
