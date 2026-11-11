import { test, expect, type Page } from '@playwright/test';

const columns = ['id', 'name', 'city', 'note'].map(name => ({
  name,
  data_type: name === 'id' ? 'integer' : 'text',
  options: ['nullable', 'updatable'],
}));

async function mock(page: Page) {
  const rows = [
    { id: 1, name: 'Mia', city: 'Huế', note: 'a' },
    { id: 2, name: 'Lune', city: 'Đà Lạt', note: 'b' },
    { id: 3, name: 'Sol', city: 'Hội An', note: 'c' },
  ];
  const patches: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      patches.push(body.values);
      const row = rows.find(x => x.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows, total: rows.length } });
  });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(3);
  return { patches };
}

const cell = (page: Page, row: number, column: string) =>
  page.locator(`#grid td[data-bulk-row="${row}"][data-bulk-column="${column}"]`);

test('mũi tên di chuyển giữa các ô', async ({ page }) => {
  await mock(page);
  // name is pinned by default, so it comes before id.
  await cell(page, 0, 'name').focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 0, 'id')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 0, 'city')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 1, 'city')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, 1, 'id')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 0, 'id')).toBeFocused();
  await expect(page.locator('td.editing')).toHaveCount(0);
});

test('gõ ký tự vào sửa ô, Enter lưu và xuống dòng dưới', async ({ page }) => {
  const api = await mock(page);
  await cell(page, 0, 'name').focus();
  await page.keyboard.type('Ana');
  await expect(page.locator('td.editing input')).toHaveValue('Ana');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 'name')).toHaveText('Ana');
  await expect(cell(page, 1, 'name')).toBeFocused();
  expect(api.patches).toEqual([{ name: 'Ana' }]);
});

test('Tab lưu và sang ô bên phải, Shift+Tab sang trái', async ({ page }) => {
  const api = await mock(page);
  await cell(page, 1, 'city').focus();
  await page.keyboard.press('Enter');
  await page.locator('td.editing input').fill('Sài Gòn');
  await page.keyboard.press('Tab');
  await expect(cell(page, 1, 'city')).toHaveText('Sài Gòn');
  await expect(cell(page, 1, 'note')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 1, 'city')).toBeFocused();
  expect(api.patches).toEqual([{ city: 'Sài Gòn' }]);
});

test('Escape hủy sửa và giữ ô đang chọn', async ({ page }) => {
  const api = await mock(page);
  await cell(page, 2, 'name').focus();
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  await expect(page.locator('td.editing')).toHaveCount(0);
  await expect(cell(page, 2, 'name')).toHaveText('Sol');
  await expect(cell(page, 2, 'name')).toBeFocused();
  expect(api.patches).toEqual([]);
});

test('bấm sang ô khác khi đang sửa thì lưu ô cũ và mở ô mới ngay', async ({ page }) => {
  const api = await mock(page);
  await cell(page, 0, 'name').click();
  await page.locator('td.editing input').fill('Mai');
  await cell(page, 2, 'city').click();
  await expect(cell(page, 0, 'name')).toHaveText('Mai');
  await expect(cell(page, 2, 'city').locator('input')).toBeFocused();
  await expect(cell(page, 2, 'city').locator('input')).toHaveValue('Hội An');
  expect(api.patches).toEqual([{ name: 'Mai' }]);
});
