import { test, expect } from '@playwright/test';

test('khóa ngoại hiện tên bản ghi liên kết và cột id uuid xếp cuối', async ({ page }) => {
  const rooms = {
    name: 'public.rooms',
    columns: [
      { name: 'id', data_type: 'uuid', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
      { name: 'branchid', data_type: 'uuid', options: ['updatable', 'nullable'] },
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
  const branches = {
    name: 'public.branches',
    columns: [
      { name: 'id', data_type: 'uuid', options: ['updatable'] },
      { name: 'code', data_type: 'integer', options: ['updatable'] },
      { name: 'address', data_type: 'text', options: ['updatable'] },
    ],
    primary_keys: ['id'],
  };
  const lookups: unknown[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [rooms, branches], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (url.pathname === '/api/lookup/branches') {
      lookups.push(route.request().postDataJSON());
      return route.fulfill({ json: { rows: [{ id: 'b-1', address: '12 Lê Lợi' }] } });
    }
    return route.fulfill({
      json: { rows: [{ id: '7f3e2c1a-0000-4000-8000-000000000001', name: 'Studio', branchid: 'b-1' }], total: 1 },
    });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="branchid"]');
  // branches has no name column, so the first text column is shown.
  await expect(cell).toHaveText('12 Lê Lợi');
  await expect(cell).toHaveAttribute('title', 'b-1');
  expect(lookups).toEqual([{ column: 'id', values: ['b-1'], fields: ['address'] }]);
  const order = await page
    .locator('#grid thead th[data-column-id]')
    .evaluateAll(heads => heads.map(head => (head as HTMLElement).dataset.columnId));
  expect(order).toEqual(['col:name', 'col:branchid', 'col:id']);
  await expect(page.locator('#grid th[data-column-id="col:id"]')).toHaveClass(/uuid-id/);
});
