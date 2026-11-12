import { test, expect } from '@playwright/test';

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
