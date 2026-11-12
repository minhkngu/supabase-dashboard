import { test, expect, type Page } from '@playwright/test';
async function fixture(page: Page, blocked = false) {
  let deleted = false;
  let applies = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              primary_keys: ['id'],
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'], protected: true, delete_protected: true },
                { name: 'amount', data_type: 'numeric', options: ['nullable', 'updatable'] },
                ...(!deleted
                  ? [
                      {
                        name: 'total',
                        data_type: 'numeric',
                        options: ['nullable', 'updatable', 'generated'],
                        protected: true,
                        delete_protected: false,
                        default_value: '(0.45 * amount)',
                      },
                    ]
                  : []),
              ],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (path === '/api/admin/schema/preview') {
      expect(route.request().postDataJSON()).toEqual({ table: 'demo', action: 'delete', column: 'total' });
      if (blocked)
        return route.fulfill({
          status: 400,
          json: { error: 'Không thể xóa cột vì đang được sử dụng bởi: view room_totals' },
        });
      return route.fulfill({
        json: {
          signature: 'a'.repeat(64),
          affected: 1,
          dependenciesChecked: true,
          generatedExpression: '(0.45 * amount)',
        },
      });
    }
    if (path === '/api/admin/schema/apply') {
      expect(route.request().postDataJSON().signature).toBe('a'.repeat(64));
      applies++;
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, amount: 100, ...(!deleted ? { total: 45 } : {}) }], total: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  return () => applies;
}
test('xóa cột công thức cần xác nhận, có thể hủy, tự cập nhật bảng', async ({ page }) => {
  const applies = await fixture(page);
  await expect(page.locator('#columnName')).toBeDisabled();
  await expect(page.locator('#columnType')).toBeDisabled();
  await expect(page.locator('#deleteColumn')).toBeEnabled();
  await page.locator('#deleteColumn').click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await expect(page.locator('#confirmMessage')).toContainText('0.45 * amount');
  await expect(page.locator('#confirmMessage')).toContainText('không có thành phần phụ thuộc');
  expect(applies()).toBe(0);
  await page.locator('#confirmCancel').click();
  expect(applies()).toBe(0);
  await expect(page.locator('#columnDialog')).toBeVisible();
  await page.locator('#deleteColumn').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  await expect(page.locator('#grid th[data-column-id="col:total"]')).toHaveCount(0);
  expect(applies()).toBe(1);
});
test('phụ thuộc chặn xóa trước bước xác nhận', async ({ page }) => {
  const applies = await fixture(page, true);
  await page.locator('#deleteColumn').click();
  await expect(page.locator('#columnError')).toContainText('view room_totals');
  await expect(page.locator('#confirmDialog')).toBeHidden();
  expect(applies()).toBe(0);
});
