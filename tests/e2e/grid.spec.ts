import { test, expect } from '@playwright/test';

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
  // Pinning is applied one frame after the rows are drawn.
  await expect(page.locator('#grid tbody td.frozen-number').first()).toBeVisible();
  const before = await checkbox.boundingBox();
  await page.locator('.table-scroll').evaluate(node => {
    node.scrollLeft = 500;
  });
  await expect.poll(async () => page.locator('.table-scroll').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const after = await checkbox.boundingBox();
  if (!before || !after) throw Error('Không thấy ô chọn dòng');
  expect(Math.abs(before.x - after.x)).toBeLessThan(2);
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
