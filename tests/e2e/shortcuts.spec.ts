import { test, expect, type Page } from '@playwright/test';

const table = (name: string) => ({
  name: `public.${name}`,
  primary_keys: ['id'],
  columns: ['id', 'name'].map(column => ({ name: column, data_type: 'text', options: ['updatable'] })),
});

async function mock(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta')
      return route.fulfill({
        json: { tables: [table('branches'), table('room_types'), table('promotions')], token: 't' },
      });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    return route.fulfill({ json: { rows: [{ id: '1', name: url.pathname.split('/').pop() }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('branches');
}

test('phím / đưa con trỏ vào ô tìm kiếm', async ({ page }) => {
  await mock(page);
  await page.locator('#grid tbody td').first().focus();
  await page.keyboard.press('/');
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('#search')).toHaveValue('');
});

test('Ctrl+K mở hộp chuyển bảng, tìm và mở bảng bằng bàn phím', async ({ page }) => {
  await mock(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Chuyển bảng nhanh' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#quickSwitchInput')).toBeFocused();
  await expect(dialog.getByRole('option')).toHaveCount(3);
  await page.keyboard.type('room');
  await expect(dialog.getByRole('option')).toHaveText(['room_types']);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#title')).toHaveText('room_types');

  await page.keyboard.press('Control+k');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('option', { selected: true })).toHaveText('promotions');
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveText('promotions');

  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#title')).toHaveText('promotions');
});
