import { test, expect } from '@playwright/test';

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
  const lookup = {
    id: 'test',
    sourceTable: 'rooms',
    sourceColumn: 'branchid',
    targetTable: 'branches',
    targetKey: 'id',
    targetField: 'name',
    label: 'Tên chi nhánh',
  };
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: true, items: [lookup] } });
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
  const lookup = {
    id: 'test',
    sourceTable: 'rooms',
    sourceColumn: 'branchid',
    targetTable: 'branches',
    targetKey: 'id',
    targetField: 'name',
    label: 'Tên chi nhánh',
  };
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: true, items: [lookup] } });
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
  const lookup = {
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
  };
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: true, items: [lookup] } });
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
  await page.goto('/');
  await expect(page.locator('td.lookup-cell')).toHaveText('1,200,000');
  lookup.mode = 'any';
  lookup.display = 'count';
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
  const lookup = {
    id: 'test',
    sourceTable: 'rooms',
    sourceColumn: 'branchid',
    targetTable: 'branches',
    targetKey: 'id',
    targetField: 'name',
    label: 'Chi nhánh',
  };
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
      await route.fulfill({ json: { available: true, items: [lookup] } });
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
