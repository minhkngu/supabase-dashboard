import { test, expect, type Page } from '@playwright/test';

const columns = ['id', 'name', 'qty', 'total'].map(name => ({
  name,
  data_type: name === 'name' ? 'text' : 'integer',
  options: ['nullable', 'updatable'],
}));

async function mock(page: Page, formulas: unknown[]) {
  const counts = { reads: 0, patches: 0 };
  let row = { id: 1, name: 'Mia', qty: 2, total: 4 };
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: formulas } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (url.pathname === '/api/ui-settings') return route.fulfill({ json: { available: false, items: {} } });
    if (request.method() === 'PATCH') {
      counts.patches++;
      row = { ...row, ...request.postDataJSON().values };
      return route.fulfill({ json: { rows: [row] } });
    }
    counts.reads++;
    return route.fulfill({ json: { rows: [row], total: 1 } });
  });
  return counts;
}

async function editName(page: Page) {
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await page.locator('td.cell-editable').filter({ hasText: 'Mia' }).click();
  await page.locator('td.editing input').fill('Lune');
  await page.locator('td.editing input').press('Enter');
  await expect(page.locator('#toast .toast-text')).toHaveText('Đã lưu thay đổi');
}

test('lưu ô ở bảng không có formula không tải lại dữ liệu', async ({ page }) => {
  const counts = await mock(page, []);
  await editName(page);
  expect(counts.patches).toBe(1);
  await page.waitForTimeout(300);
  expect(counts.reads).toBe(1);
  await expect(page.locator('#grid tbody')).toContainText('Lune');
});

test('lưu ô ở bảng có formula tải lại để lấy giá trị tự tính', async ({ page }) => {
  const counts = await mock(page, [{ table: 'demo', column: 'total', expression: '[qty] * 2', enabled: true }]);
  await editName(page);
  await expect.poll(() => counts.reads).toBe(2);
});

test('sửa hàng loạt gửi một yêu cầu lô và báo lỗi theo dòng', async ({ page }) => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `R${i + 1}`, qty: 1, total: 1 }));
  let batches = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (request.method() === 'POST' && url.pathname.endsWith('/batch')) {
      batches++;
      const { changes } = request.postDataJSON();
      const results = changes.map((change: { key: { id: number }; values: Record<string, unknown> }) => {
        if (change.key.id === 3) return { ok: false, error: 'Xung đột' };
        const row = rows.find(x => x.id === change.key.id)!;
        Object.assign(row, change.values);
        return { ok: true, rows: [row] };
      });
      return route.fulfill({ json: { results } });
    }
    return route.fulfill({ json: { rows, total: rows.length } });
  });
  await page.goto('/');
  const cells = page.locator('td[data-bulk-column="name"]');
  await expect(cells).toHaveCount(8);
  await cells.nth(0).click({ modifiers: ['Shift'] });
  await cells.nth(7).click({ modifiers: ['Shift'] });
  await expect(page.locator('#bulkLabel')).toHaveText('name · 8 ô');
  await page.locator('#bulkValue').fill('Mới');
  await page.locator('#bulkApply').click();
  await expect(page.locator('#bulkError')).toContainText('Đã lưu 7/8 dòng. Dòng 3: Xung đột');
  expect(batches).toBe(1);
  expect(rows.filter(x => x.name === 'Mới')).toHaveLength(7);
});
