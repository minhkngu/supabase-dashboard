import { test, expect, type Page } from '@playwright/test';

const columns = ['id', 'name', 'city'].map(name => ({
  name,
  data_type: name === 'id' ? 'integer' : 'text',
  options: ['nullable', 'updatable'],
}));

async function mock(page: Page) {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    requests.push(url.searchParams);
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia', city: 'Huế' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  return requests;
}

const header = (page: Page, column: string) => page.locator(`#grid th[data-column-id="col:${column}"]`);

test('menu tiêu đề cột sắp xếp, ẩn và ghim cột', async ({ page }) => {
  const requests = await mock(page);
  await header(page, 'city').click();
  const menu = page.getByRole('menu', { name: 'Tùy chọn cột city' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sắp xếp tăng dần' })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Sắp xếp giảm dần' }).click();
  await expect(menu).toBeHidden();
  await expect
    .poll(() => JSON.parse(requests.at(-1)?.get('orders') || '[]'))
    .toEqual(expect.arrayContaining([{ column: 'city', direction: 'desc' }]));
  await expect(page.locator('#sortMenu')).toBeHidden();

  await header(page, 'city').click();
  await page.getByRole('menuitem', { name: 'Ghim cột' }).click();
  await expect(header(page, 'city')).toHaveClass(/frozen-cell/);

  await header(page, 'id').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Thiết lập cột' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(header(page, 'id')).toBeFocused();

  await header(page, 'id').click();
  await page.getByRole('menuitem', { name: 'Ẩn cột' }).click();
  await expect(header(page, 'id')).toHaveCount(0);
  await expect(page.locator('#hiddenColumnCount')).toHaveText('1');
});

test('menu tiêu đề cột thêm bộ lọc và nhóm theo cột', async ({ page }) => {
  const requests = await mock(page);
  await header(page, 'name').click();
  await page.getByRole('menuitem', { name: 'Lọc theo cột này' }).click();
  await expect(page.locator('#filterMenu input:not([type="checkbox"])').last()).toBeFocused();
  await expect(page.locator('#filterMenu')).toBeVisible();
  await page.keyboard.type('Mi');
  await expect
    .poll(() => JSON.parse(requests.at(-1)?.get('filters') || '[]'))
    .toEqual([{ column: 'name', operator: 'contains', value: 'Mi' }]);
  await page.keyboard.press('Escape');
  await header(page, 'city').click();
  await page.getByRole('menuitem', { name: 'Nhóm theo cột này' }).click();
  await expect(page.locator('.group-label').first()).toHaveText('Huế');
});

test('bộ lọc, nhóm và sắp xếp đang bật hiện thành thẻ có thể gỡ', async ({ page }) => {
  const requests = await mock(page);
  await expect(page.locator('#ruleChips')).toBeHidden();
  await header(page, 'name').click();
  await page.getByRole('menuitem', { name: 'Lọc theo cột này' }).click();
  await expect(page.locator('#filterMenu input:not([type="checkbox"])').last()).toBeFocused();
  await page.keyboard.type('Mi');
  await expect.poll(() => JSON.parse(requests.at(-1)?.get('filters') || '[]')[0]?.value).toBe('Mi');
  await page.keyboard.press('Escape');
  await header(page, 'city').click();
  await page.getByRole('menuitem', { name: 'Sắp xếp giảm dần' }).click();
  const chips = page.locator('#ruleChips .rule-chip');
  await expect(chips).toHaveText(['name chứa “Mi”×', 'Sắp xếp: city ↓×']);
  await page.getByRole('button', { name: 'Bỏ lọc name' }).click();
  await expect(chips).toHaveText(['Sắp xếp: city ↓×']);
  await expect.poll(() => requests.at(-1)?.get('filters')).toBe('[]');
  await page.getByRole('button', { name: 'Bỏ sắp xếp theo city' }).click();
  await expect(page.locator('#ruleChips')).toBeHidden();
});

test('số đếm của nhóm tính trên toàn bộ dữ liệu đã lọc', async ({ page }) => {
  await mock(page);
  await page.route('**/api/table/demo/group-counts**', async route => {
    const paths = JSON.parse(new URL(route.request().url()).searchParams.get('paths') || '[]');
    return route.fulfill({ json: { counts: paths.map(() => 42) } });
  });
  await header(page, 'city').click();
  await page.getByRole('menuitem', { name: 'Nhóm theo cột này' }).click();
  await expect(page.locator('.group-count').first()).toHaveText('42 bản ghi');
});
