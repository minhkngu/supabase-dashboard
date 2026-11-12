import { test, expect, type Page, type Route } from '@playwright/test';
const openDashboard = (page: Page) => page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
const col = (name: string) => ({ name, data_type: 'text', options: ['nullable', 'updatable'] });
const branches = {
  name: 'public.branches',
  primary_keys: ['id'],
  columns: ['id', 'name', 'address', 'is_hidden'].map(col),
};
const rooms = {
  name: 'public.room_types',
  primary_keys: ['id'],
  columns: ['id', 'name', 'branchid', 'weekdayprice', 'weekendprice', 'sqm', 'is_hidden'].map(col),
};
const items = {
  name: 'public.items',
  primary_keys: ['id'],
  columns: ['id', 'item_name', 'kind', 'quantity', 'unit_price'].map(col),
};
const other = { name: 'public.other', primary_keys: ['id'], columns: ['id', 'title', 'notes'].map(col) };
async function mock(page: Page) {
  let fail = false,
    writes = 0;
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() !== 'GET') {
      writes++;
      return route.fulfill({ json: {} });
    }
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [branches, rooms, items, other], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (fail && url.pathname === '/api/table/items')
      return route.fulfill({ status: 403, json: { error: 'Không có quyền đọc' } });
    const values: Record<string, unknown[]> = {
      '/api/table/branches': [{ id: 'b1', name: 'Mia', address: 'Địa chỉ', is_hidden: false }],
      '/api/table/room_types': [
        { id: 'r1', name: 'Studio', branchid: 'b1', weekdayprice: 440, weekendprice: 480, sqm: 25, is_hidden: false },
      ],
      '/api/table/items': [{ id: 1, item_name: 'Khăn', kind: 'Vải', quantity: 3, unit_price: 20000 }],
      '/api/table/other': [{ id: 1, title: 'Thử', notes: 'Nội dung' }],
    };
    const rows = values[url.pathname] || [];
    return route.fulfill({ json: { rows, total: rows.length } });
  });
  return {
    setFail: () => {
      fail = true;
    },
    writes: () => writes,
  };
}
test('dashboard xem thông tin, chi tiết, tìm kiếm và giữ chế độ theo bảng', async ({ page }) => {
  const api = await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Tổng quan chi nhánh');
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
  // Adding records also works from the dashboard.
  await expect(page.locator('#add')).toBeVisible();
  await expect(page.locator('#undoCell')).toBeHidden();
  await page.getByRole('button', { name: 'room_types', exact: true }).click();
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Studio');
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
  await expect(page.locator('#tableDashboard')).toContainText('440đ');
  await page.getByRole('button', { name: 'Xem chi tiết Studio' }).click();
  await expect(page.locator('dialog[open]')).toContainText('480đ');
  await page.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await page.getByRole('button', { name: 'items', exact: true }).click();
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('60.000đ');
  await page.locator('[data-overview-search]').fill('khăn');
  await expect(page.locator('[data-overview-count]')).toHaveText('1 / 1 bản ghi');
  await api.setFail();
  await page.locator('[data-overview-refresh]').click();
  await expect(page.locator('[data-overview-feedback]')).toContainText('Đang giữ dữ liệu lần trước');
  await page.getByRole('button', { name: 'Bảng dữ liệu', exact: true }).click();
  await expect(page.locator('.grid-shell')).toBeVisible();
  await page.getByRole('button', { name: 'other', exact: true }).click();
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Thử');
  await page.reload();
  await expect(page.locator('#title')).toHaveText('other');
  await page.getByRole('button', { name: 'items', exact: true }).click();
  await expect(page.locator('.grid-shell')).toBeVisible();
  expect(api.writes()).toBe(0);
});
test('dashboard vừa màn hình nhỏ', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('điện thoại: nút thêm bản ghi không bị cắt, chỉ giữ nút đóng sidebar, hàng tổng quan xếp dọc', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/');
  const add = await page.locator('#add').boundingBox();
  expect(add && add.x >= 0 && add.x + add.width <= 390).toBe(true);
  await page.locator('#openNav').click();
  await expect(page.locator('#closeNav')).toBeVisible();
  await expect(page.locator('#toggleSidebar')).toBeHidden();
  await expect(page.locator('#sidebarToggleBtn')).toBeHidden();
  await page.locator('#closeNav').click();
  await openDashboard(page);
  const row = page.locator('.overview-row').first();
  await expect(row).toContainText('Mia');
  await expect(row).toHaveCSS('flex-direction', 'column');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
