import { test, expect, type Page } from '@playwright/test';

const table = (name: string) => ({
  name: `public.${name}`,
  primary_keys: ['id'],
  columns: [{ name: 'id', data_type: 'integer', options: ['updatable'] }],
});

async function mock(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [table('rooms')], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await page.locator('#addFolder').click();
  await page.locator('#newFolderName').fill('Phòng');
  await page.locator('#newFolderName').press('Enter');
  await page.locator('#addFolder').click();
  await page.locator('#newFolderName').fill('Khác');
  await page.locator('#newFolderName').press('Enter');
  await expect(page.locator('.folder-name')).toHaveText(['Phòng', 'Khác']);
}

test('đổi tên thư mục qua menu, chặn tên trùng và hủy bằng Escape', async ({ page }) => {
  page.on('dialog', () => {
    throw Error('Không được dùng hộp thoại gốc của trình duyệt');
  });
  await mock(page);
  await page.getByRole('button', { name: 'Tùy chọn Phòng' }).click();
  await page.getByRole('menuitem', { name: 'Đổi tên' }).click();
  const dialog = page.locator('#confirmDialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#confirmInput')).toHaveValue('Phòng');
  await page.locator('#confirmInput').fill('Khác');
  await page.keyboard.press('Enter');
  await expect(page.locator('#confirmError')).toHaveText('Đã có thư mục cùng tên.');
  await page.locator('#confirmInput').fill('Studio');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.folder-name')).toHaveText(['Studio', 'Khác']);
  await page.getByRole('button', { name: 'Tùy chọn Studio' }).click();
  await page.getByRole('menuitem', { name: 'Đổi tên' }).click();
  await page.locator('#confirmInput').fill('Bỏ');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.folder-name')).toHaveText(['Studio', 'Khác']);
});

test('xóa thư mục cần xác nhận trong hộp thoại', async ({ page }) => {
  await mock(page);
  await page.getByRole('button', { name: 'Tùy chọn Khác' }).click();
  await page.getByRole('menuitem', { name: 'Xóa thư mục' }).click();
  await expect(page.locator('#confirmTitle')).toHaveText('Xóa thư mục “Khác”?');
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.locator('.folder-name')).toHaveText(['Phòng', 'Khác']);
  await page.getByRole('button', { name: 'Tùy chọn Khác' }).click();
  await page.getByRole('menuitem', { name: 'Xóa thư mục' }).click();
  await page.locator('#confirmDialog').getByRole('button', { name: 'Xóa thư mục' }).click();
  await expect(page.locator('.folder-name')).toHaveText(['Phòng']);
});
