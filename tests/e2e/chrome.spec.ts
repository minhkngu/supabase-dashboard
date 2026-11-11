import { test, expect, type Page } from '@playwright/test';

const columns = [
  { name: 'id', data_type: 'integer', options: ['updatable'], default_value: "nextval('branches_id_seq')" },
  { name: 'name', data_type: 'text', options: ['updatable'] },
  { name: 'address', data_type: 'text', options: ['updatable', 'nullable'] },
  { name: 'is_hidden', data_type: 'boolean', options: ['updatable', 'nullable'] },
];

async function mock(page: Page, count = 3) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Chi nhánh ${i + 1}`,
    address: `${i + 1} Lê Lợi`,
    is_hidden: false,
  }));
  const writes: { method: string; body: { key?: Record<string, unknown>; values: Record<string, unknown> } }[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
      return route.fulfill({
        json: { tables: [{ name: 'public.branches', columns, primary_keys: ['id'] }], token: 't' },
      });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      writes.push({ method: 'POST', body });
      const row = { id: rows.length + 1, address: null, is_hidden: null, ...body.values };
      rows.push(row);
      return route.fulfill({ json: { rows: [row] } });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push({ method: 'PATCH', body });
      const row = rows.find(x => x.id === body.key.id)!;
      Object.assign(row, body.values);
      return route.fulfill({ json: { rows: [row] } });
    }
    const limit = Number(url.searchParams.get('limit') || 50),
      p = Number(url.searchParams.get('page') || 0);
    return route.fulfill({ json: { rows: rows.slice(p * limit, p * limit + limit), total: rows.length } });
  });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(Math.min(count, 50));
  return { rows, writes };
}

const dashboardButton = (page: Page) => page.getByRole('button', { name: 'Tổng quan', exact: true });
const tableButton = (page: Page) => page.getByRole('button', { name: 'Bảng dữ liệu', exact: true });

test('chuyển Tổng quan ↔ Bảng dữ liệu không làm nút nhảy và luôn có Thêm bản ghi', async ({ page }) => {
  await mock(page);
  const before = await page.locator('#promotionsViewSwitch').boundingBox(),
    addBefore = await page.locator('#add').boundingBox();
  await dashboardButton(page).click();
  await expect(page.locator('#tableDashboard')).toContainText('Chi nhánh 1');
  await expect(page.locator('#add')).toBeVisible();
  await expect(page.locator('#add')).toBeEnabled();
  await expect(page.locator('#undoCell')).toBeHidden();
  expect(await page.locator('#promotionsViewSwitch').boundingBox()).toEqual(before);
  expect(await page.locator('#add').boundingBox()).toEqual(addBefore);
  await tableButton(page).click();
  await expect(page.locator('#undoCell')).toBeVisible();
  expect(await page.locator('#promotionsViewSwitch').boundingBox()).toEqual(before);
  expect(await page.locator('#add').boundingBox()).toEqual(addBefore);
});

test('thêm bản ghi từ Tổng quan rồi Tổng quan tải lại có bản ghi mới', async ({ page }) => {
  const api = await mock(page);
  await dashboardButton(page).click();
  await expect(page.locator('[data-overview-count]')).toHaveText('3 / 3 bản ghi');
  await page.locator('#add').click();
  await page.locator('#field-name').fill('Chi nhánh mới');
  await page.locator('#save').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('[data-overview-count]')).toHaveText('4 / 4 bản ghi');
  await expect(page.locator('#tableDashboard')).toContainText('Chi nhánh mới');
  expect(api.writes.map(w => w.method)).toEqual(['POST']);
  expect(api.writes[0].body.values).toEqual({ name: 'Chi nhánh mới', address: null, is_hidden: null });
});

test('sửa bản ghi từ hộp Chi tiết của Tổng quan, không có nút xóa', async ({ page }) => {
  const api = await mock(page);
  await dashboardButton(page).click();
  await page.getByRole('button', { name: 'Xem chi tiết Chi nhánh 2' }).click();
  await page.getByRole('button', { name: 'Sửa bản ghi', exact: true }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#delete')).toBeHidden();
  await expect(page.locator('#field-name')).toHaveValue('Chi nhánh 2');
  await page.locator('#field-address').fill('99 Trần Phú');
  await page.locator('#save').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#tableDashboard')).toContainText('99 Trần Phú');
  expect(api.writes).toEqual([{ method: 'PATCH', body: { key: { id: 2 }, values: { address: '99 Trần Phú' } } }]);
  // The grid editor still offers deletion.
  await tableButton(page).click();
  await page.locator('#grid tbody tr').first().locator('.record-index').click();
  await expect(page.locator('#delete')).toBeVisible();
});
