import { test, expect } from '@playwright/test';
import { answerConfig } from './helpers/mock-api';

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
    if (req.method() === 'POST' && path.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        writes.push(change);
        const row = rows.find(item => item.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      return route.fulfill({ json: { results } });
    }
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

test('thanh công cụ gọn trên màn hình lớn và nhỏ', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (await answerConfig(route)) return;
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
