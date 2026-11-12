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

test('đặt tên hiển thị cho bảng, giữ sau khi tải lại và trả về tên gốc khi để trống', async ({ page }) => {
  await mock(page);
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Đổi tên hiển thị của bảng' }).click();
  await page.locator('#confirmInput').fill('Loại phòng');
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveText('Loại phòng');
  await expect(page.getByRole('button', { name: 'Loại phòng', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#title')).toHaveText('Loại phòng');
  await page.locator('#tableSearch').fill('rooms');
  await expect(page.getByRole('button', { name: 'Loại phòng', exact: true })).toBeVisible();
  await page.locator('#tableSearch').fill('');
  await page.getByRole('button', { name: 'Đổi tên hiển thị của bảng' }).click();
  await page.locator('#confirmInput').fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveText('rooms');
});

test('khi mọi bảng đã vào thư mục vẫn có vùng thả ra ngoài, và kéo ra được', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'siris-table-folders',
      JSON.stringify({ folders: [{ id: 'f1', name: 'Phòng' }], tableFolders: { rooms: 'f1' }, labels: {} }),
    );
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [table('rooms')], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('.folder.unfiled')).toHaveCount(1);
  await page.evaluate(() => {
    const item = document.querySelector('.nav-item')!,
      data = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
  });
  await expect(page.locator('#tables')).toHaveClass(/sidebar-dragging/);
  await page.evaluate(() => {
    const target = document.querySelector('.folder.unfiled')!,
      data = new DataTransfer();
    data.setData('text/plain', 'rooms');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.locator('.folder.unfiled .nav-item')).toHaveCount(1);
  await expect(page.locator('.folder:not(.unfiled) .nav-item')).toHaveCount(0);
});

test('rê bảng qua thư mục đang thu gọn thì thư mục tự mở', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'siris-table-folders',
      JSON.stringify({ folders: [{ id: 'f1', name: 'Phòng', collapsed: true }], tableFolders: {}, labels: {} }),
    );
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [table('rooms')], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('.folder:not(.unfiled)')).toHaveClass(/collapsed/);
  await page.evaluate(() => {
    document
      .querySelector('.folder:not(.unfiled)')!
      .dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  });
  await expect(page.locator('.folder:not(.unfiled)')).not.toHaveClass(/collapsed/, { timeout: 3000 });
});
