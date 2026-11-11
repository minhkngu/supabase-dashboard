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
  await expect(page.locator('#toast')).toHaveText('Đã lưu thay đổi');
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
