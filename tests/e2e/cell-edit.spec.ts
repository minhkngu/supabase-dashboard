import { test, expect } from '@playwright/test';

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
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        if (change.key.id === 2) return { ok: false, error: 'Xung đột' };
        const row = rows.find(x => x.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      await route.fulfill({ json: { results } });
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
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        const row = rows.find(x => x.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      await route.fulfill({ json: { results } });
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
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        values.push(change.values.price as string);
        return { ok: true, rows: [{ ...rows[change.key.id - 1], ...change.values }] };
      });
      await route.fulfill({ json: { results } });
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
    if (request.method() === 'POST' && path.endsWith('/batch')) {
      const { changes } = request.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        writes.push(change);
        const row = rows.find(item => item.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      return route.fulfill({ json: { results } });
    }
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
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        const row = rows.find(x => x.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      return route.fulfill({ json: { results } });
    }
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
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/batch')) {
      const { changes } = req.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        const row = rows.find(x => x.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      return route.fulfill({ json: { results } });
    }
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
