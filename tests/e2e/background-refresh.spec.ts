import { test, expect } from '@playwright/test';

test('giữ bảng thao tác được khi chờ làm mới, không ghi đè ô đang sửa', async ({ page }) => {
  let reads = 0;
  let finish!: () => void;
  const wait = new Promise<void>(resolve => {
    finish = resolve;
  });
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              primary_keys: ['id'],
              columns: ['id', 'name'].map(name => ({
                name,
                data_type: name === 'id' ? 'integer' : 'text',
                options: ['nullable', 'updatable'],
              })),
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (path === '/api/table/demo' && req.method() === 'GET') {
      reads++;
      if (reads === 2) await wait;
      return route.fulfill({ json: { rows: [{ id: 1, name: reads === 1 ? 'Mia' : 'Old server value' }], total: 1 } });
    }
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  const cell = page.locator('td[data-bulk-column="name"]');
  await expect(cell).toHaveClass(/cell-editable/);
  await page.locator('#refresh').click();
  await expect.poll(() => reads).toBe(2);
  await expect(cell).toHaveText('Mia');
  await cell.click();
  const input = page.getByRole('textbox', { name: 'Sửa name', exact: true });
  await input.fill('Draft kept');
  finish();
  await expect(input).toHaveValue('Draft kept');
});
