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

test('tick một dòng hoặc chọn tất cả không đẩy lưới; thanh chọn nổi và bấm được', async ({ page }) => {
  await mock(page, 60);
  const firstRow = page.locator('#grid tbody tr').first(),
    y = (await firstRow.boundingBox())!.y;
  await page.getByRole('checkbox', { name: 'Chọn dòng 1', exact: true }).check();
  await expect(page.locator('#rowSelectionBar')).toBeVisible();
  await expect(page.locator('#rowSelectionSummary')).toHaveText('1 dòng đã chọn');
  expect((await firstRow.boundingBox())!.y).toBe(y);
  await page.getByRole('checkbox', { name: 'Chọn tất cả dòng hiển thị trên trang', exact: true }).check();
  // 60 rows over two pages: only this page's 50 rows are selected.
  await expect(page.locator('#rowSelectionSummary')).toHaveText('50 dòng đã chọn trên trang này');
  expect((await firstRow.boundingBox())!.y).toBe(y);
  const bar = (await page.locator('#rowSelectionBar').boundingBox())!,
    shell = (await page.locator('.grid-shell').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(shell.y + shell.height);
  await expect(page.getByRole('button', { name: 'Xóa 50 dòng đã chọn' })).toBeEnabled();
  await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
  await expect(page.locator('#rowSelectionBar')).toBeHidden();
  expect((await firstRow.boundingBox())!.y).toBe(y);
});

test('ô chọn tất cả thẳng hàng với ô chọn của các dòng', async ({ page }) => {
  await mock(page);
  const header = (await page.locator('#grid input[data-rows-select-all]').boundingBox())!,
    row = (await page.locator('#grid input[data-row-select]').first().boundingBox())!;
  expect(Math.abs(header.x - row.x)).toBeLessThan(1);
});

test('cuộn ngang 600px giữ nguyên ô chọn của dòng đầu', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await mock(page);
  const box = page.locator('#grid input[data-row-select]').first(),
    x = (await box.boundingBox())!.x;
  await page.locator('.table-scroll').evaluate(node => {
    (node.querySelector('#grid') as HTMLElement).style.minWidth = '2000px';
    node.scrollLeft = 600;
  });
  await expect.poll(() => page.locator('.table-scroll').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expect((await box.boundingBox())!.x).toBe(x);
});

test('khung 390px: nút Thêm bản ghi nằm trọn trong màn hình, nút menu đủ lớn để bấm', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  const add = (await page.locator('#add').boundingBox())!;
  expect(add.x).toBeGreaterThanOrEqual(0);
  expect(add.x + add.width).toBeLessThanOrEqual(390);
  // Icon only, but still named for screen readers.
  await expect(page.getByRole('button', { name: 'Thêm bản ghi', exact: true })).toBeVisible();
  expect(add.width).toBeLessThanOrEqual(40);
  for (const id of ['#openNav', '#closeNav']) {
    if (id === '#closeNav') await page.locator('#openNav').click();
    const box = (await page.locator(id).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(36);
    expect(box.height).toBeGreaterThanOrEqual(36);
  }
  await expect(page.locator('#toggleSidebar')).toBeHidden();
  await expect(page.locator('#sidebarToggleBtn')).toBeHidden();
});
