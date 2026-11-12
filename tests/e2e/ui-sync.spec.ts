import { test, expect, type Page } from '@playwright/test';

async function mock(page: Page, store: Record<string, { value: unknown; updatedAt: number }>, writes: string[]) {
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
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
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (url.pathname === '/api/ui-settings') {
      if (request.method() === 'POST') {
        const { key, value } = request.postDataJSON();
        const updatedAt = Date.now();
        store[key] = { value, updatedAt };
        writes.push(key);
        return route.fulfill({ json: { ok: true, updatedAt } });
      }
      return route.fulfill({ json: { available: true, items: store } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, name: 'A' }], total: 1 } });
  });
}

test('đổi cấu hình, xóa localStorage, tải lại thì cấu hình về lại từ máy chủ', async ({ page }) => {
  const store: Record<string, { value: unknown; updatedAt: number }> = {},
    writes: string[] = [];
  await mock(page, store, writes);
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await page.locator('#columnsButton').click();
  await page.locator('#columnVisibility label').filter({ hasText: 'name' }).click();
  await expect(page.locator('thead')).not.toContainText('name');
  await expect.poll(() => writes).toContain('views');
  await page.evaluate(() => localStorage.clear());
  // Stop the page from writing its current state back during unload.
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('thead')).not.toContainText('name');
});

test('máy chủ trống thì cấu hình sẵn có trên trình duyệt được đẩy lên', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('siris-views-v1'))
      localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { hidden: ['col:name'] } }));
  });
  const store: Record<string, { value: unknown; updatedAt: number }> = {},
    writes: string[] = [];
  await mock(page, store, writes);
  await page.goto('/');
  await expect.poll(() => writes).toContain('views');
  expect(JSON.stringify(store.views.value)).toContain('col:name');
});
