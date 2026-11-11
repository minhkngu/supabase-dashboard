import { test, expect, type Page } from '@playwright/test';

type Column = { name: string; data_type: string; format: string; options: string[] };

async function mock(page: Page, { failSettingsOnce = false } = {}) {
  const columns: Column[] = ['id', 'price', 'total'].map(name => ({
    name,
    data_type: 'numeric',
    format: 'numeric',
    options: name === 'id' ? ['updatable'] : ['updatable', 'nullable'],
  }));
  const calls: string[] = [];
  let formulas: unknown[] = [],
    failSettings = failSettingsOnce;
  await page.route('**/api/**', async route => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [{ name: 'public.rooms', columns: structuredClone(columns), primary_keys: ['id'] }],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: true, items: [] } });
    if (path === '/api/formula-config' && request.method() === 'GET')
      return route.fulfill({ json: { items: formulas } });
    if (path === '/api/formula-config') {
      const config = request.postDataJSON();
      calls.push(`formula:${config.column}`);
      formulas = [config];
      return route.fulfill({ json: { config } });
    }
    if (path === '/api/admin/schema/preview')
      return route.fulfill({ json: { signature: 'a'.repeat(64), affected: 1 } });
    if (path === '/api/admin/schema/apply') {
      const { operation } = request.postDataJSON();
      if (operation.action === 'settings' && failSettings) {
        failSettings = false;
        return route.fulfill({ status: 400, json: { error: 'Kết nối database không có đủ quyền.' } });
      }
      calls.push(`${operation.action}:${operation.column}`);
      const column = columns.find(c => c.name === operation.column)!;
      if (operation.action === 'rename') column.name = operation.newName;
      if (operation.action === 'settings')
        column.options = operation.options.nullable ? ['updatable', 'nullable'] : ['updatable'];
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/table/rooms') {
      const row = Object.fromEntries(columns.map(c => [c.name, c.name === 'id' ? 1 : 10]));
      return route.fulfill({ json: { rows: [row], total: 1 } });
    }
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  return calls;
}

async function editTotal(page: Page) {
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await page.locator('#columnName').fill('amount');
  await page.locator('#editColumnNullable').uncheck();
  await page.locator('#columnFormulaEnabled').check();
  await page.locator('#columnFormulaExpression').fill('[price] * 2');
}

test('lưu tên, thuộc tính và formula trong một lần theo thứ tự', async ({ page }) => {
  const calls = await mock(page);
  await editTotal(page);
  await page.locator('#saveColumn').click();
  await expect(page.locator('#toast')).toHaveText('Đã lưu 3 thay đổi: Đổi tên, Thuộc tính, Formula');
  expect(calls).toEqual(['rename:total', 'settings:amount', 'formula:amount']);
  await expect(page.locator('th[data-column-id="col:amount"]')).toBeVisible();
  await expect(page.locator('td[data-bulk-column="amount"]')).toHaveClass(/cell-readonly/);
});

test('lỗi giữa chừng báo bước đã xong, bước lỗi và chỉ chạy lại phần còn lại', async ({ page }) => {
  const calls = await mock(page, { failSettingsOnce: true });
  await editTotal(page);
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeVisible();
  await expect(page.locator('#columnError')).toHaveText(
    'Đã xong: Đổi tên. Lỗi ở bước “Thuộc tính”: Kết nối database không có đủ quyền. Chưa chạy: Formula.',
  );
  await expect(page.locator('#columnName')).toHaveValue('amount');
  await expect(page.locator('#editColumnNullable')).not.toBeChecked();
  await expect(page.locator('#columnFormulaExpression')).toHaveValue('[price] * 2');
  expect(calls).toEqual(['rename:total']);
  await page.locator('#saveColumn').click();
  await expect(page.locator('#toast')).toHaveText('Đã lưu 2 thay đổi: Thuộc tính, Formula');
  expect(calls).toEqual(['rename:total', 'settings:amount', 'formula:amount']);
});
