import { test, expect, type Page } from '@playwright/test';

const fields = [
  'id',
  'name',
  'name_en',
  'description',
  'branchid',
  'room_type_id',
  'minnights',
  'booking_start',
  'booking_end',
  'stay_start',
  'stay_end',
  'discountamount',
  'ispercentage',
  'discount_basis',
  'max_discount_per_night',
  'max_discount_per_stay',
  'priority',
  'is_active',
  'created_at',
];
const promotions = {
  name: 'public.promotions',
  primary_keys: ['id'],
  columns: fields.map(name => ({
    name,
    data_type: name === 'is_active' || name === 'ispercentage' ? 'boolean' : 'text',
    options: ['nullable', 'updatable'],
  })),
};
const branches = {
  name: 'public.branches',
  primary_keys: ['id'],
  columns: [
    { name: 'id', data_type: 'uuid', options: ['updatable'] },
    { name: 'name', data_type: 'text', options: ['updatable'] },
  ],
};
const roomTypes = {
  name: 'public.room_types',
  primary_keys: ['id'],
  columns: [
    { name: 'id', data_type: 'uuid', options: ['updatable'] },
    { name: 'branchid', data_type: 'uuid', options: ['updatable'] },
    { name: 'name', data_type: 'text', options: ['updatable'] },
  ],
};
const rows = Array.from({ length: 51 }, (_, i) => ({
  id: `promotion-${i}`,
  name: i === 50 ? 'Ưu đãi đã tắt' : i === 0 ? 'Ưu đãi dài ngày' : `Ưu đãi ${i}`,
  name_en: null,
  description: 'Điều kiện chương trình',
  branchid: i === 0 ? 'branch-1' : null,
  room_type_id: i === 0 ? 'room-1' : null,
  minnights: i === 0 ? 7 : 1,
  booking_start: '2026-11-01',
  booking_end: '2026-11-15',
  stay_start: '2026-11-10',
  stay_end: '2026-11-30',
  discountamount: i === 50 ? 50000 : 10,
  ispercentage: i !== 50,
  discount_basis: i === 50 ? 'per_stay' : 'per_night',
  max_discount_per_night: i === 0 ? 50000 : null,
  max_discount_per_stay: null,
  priority: i === 0 ? 10 : 0,
  is_active: i !== 50,
  created_at: '2026-11-02T08:00:00Z',
}));

const openDashboard = (page: Page) => page.getByRole('button', { name: 'Dashboard', exact: true }).click();

async function mock(page: Page, { empty = false, failRefresh = false, delay = false } = {}) {
  const pages: number[] = [];
  let writes = 0,
    loads = 0,
    release = () => {};
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [promotions, branches, roomTypes], token: 'csrf' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (request.method() !== 'GET') {
      writes++;
      return route.fulfill({ json: { rows: [] } });
    }
    if (url.pathname === '/api/table/promotions') {
      const p = Number(url.searchParams.get('page') || 0),
        limit = Number(url.searchParams.get('limit') || 50);
      pages.push(p);
      if (delay) await blocked;
      if (p === 0) loads++;
      if (failRefresh && loads > 1) return route.fulfill({ status: 403, json: { error: 'Không có quyền đọc' } });
      expect(JSON.parse(url.searchParams.get('filters') || '[]')).toEqual([]);
      return route.fulfill({
        json: { rows: empty ? [] : rows.slice(p * limit, p * limit + limit), total: empty ? 0 : rows.length },
      });
    }
    if (url.pathname === '/api/table/branches')
      return route.fulfill({ json: { rows: [{ id: 'branch-1', name: 'Mia' }], total: 1 } });
    if (url.pathname === '/api/table/room_types')
      return route.fulfill({ json: { rows: [{ id: 'room-1', branchid: 'branch-1', name: 'Studio' }], total: 1 } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  return {
    pages,
    get writes() {
      return writes;
    },
    release,
    reset() {
      pages.length = 0;
      loads = 0;
    },
  };
}

test('dashboard trong bảng promotions tải đủ các trang, liên kết tên và lọc mà không ghi dữ liệu', async ({ page }) => {
  const api = await mock(page);
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  api.reset();
  await openDashboard(page);
  const dashboard = page.locator('#promotionsDashboard');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  // The dashboard reads 1,000 rows per request, so 51 rows take one page.
  expect(api.pages).toEqual([0]);
  await expect(dashboard.locator('.promo-metrics strong')).toHaveText(['51', '50', '50', '1']);
  await expect(dashboard.locator('[data-promo-id="promotion-0"]')).toContainText('Mia · Studio');
  await dashboard.locator('[data-promo-id="promotion-0"]').click();
  await expect(dashboard.locator('.promo-detail-dialog')).toBeVisible();
  await expect(dashboard.locator('[data-promo-detail]')).toContainText('15/11/2026');
  await expect(dashboard.locator('[data-promo-detail]')).toContainText('30/11/2026');
  await dashboard.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await dashboard.getByRole('button', { name: 'Trạng thái khuyến mãi', exact: true }).click();
  await dashboard.getByRole('option', { name: 'Đã tắt', exact: true }).click();
  await expect(dashboard.locator('[data-promo-count]')).toHaveText('1 / 51 chương trình');
  await expect(dashboard.locator('.promo-metrics strong')).toHaveText(['1', '0', '0', '1']);
  await dashboard.locator('[data-promo-id="promotion-50"]').click();
  await expect(dashboard.locator('[data-promo-detail]')).toContainText('50.000đ');
  await dashboard.getByRole('button', { name: 'Đóng chi tiết' }).click();
  await dashboard.getByRole('button', { name: 'Xóa lọc', exact: true }).click();
  await dashboard.getByRole('searchbox').fill('dai ngay');
  await expect(dashboard.locator('[data-promo-count]')).toHaveText('1 / 51 chương trình');
  await dashboard.locator('[data-promo-id="promotion-0"]').click();
  await expect(dashboard.locator('.promo-detail-dialog')).toBeVisible();
  await expect(dashboard.getByRole('button', { name: 'Mở bản ghi', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dashboard.locator('.promo-detail-dialog')).toBeHidden();
  expect(api.writes).toBe(0);
});

test('chuyển giữa dashboard, bảng dữ liệu và bảng khác trong cùng web', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.getByRole('button', { name: 'Bảng dữ liệu', exact: true }).click();
  await expect(page.locator('#promotionsDashboard')).toBeHidden();
  await expect(page.locator('.grid-shell')).toBeVisible();
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('#promotionsDashboard')).toBeVisible();
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.getByRole('button', { name: 'branches', exact: true }).click();
  await expect(page.locator('#promotionsViewSwitch')).toBeVisible();
  await expect(page.locator('#promotionsDashboard')).toBeHidden();
  await expect(page.locator('.grid-shell')).toBeVisible();
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
});

test('trạng thái rỗng và refresh lỗi giữ dữ liệu cũ, không báo thành công', async ({ page }) => {
  const api = await mock(page, { failRefresh: true });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  api.reset();
  await openDashboard(page);
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.locator('[data-promo-refresh]').click();
  await expect(page.locator('[data-promo-feedback]')).toContainText('Đang giữ bản dữ liệu lần trước');
  await expect(page.locator('[data-promo-feedback]')).toContainText('Không có quyền đọc');
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.unrouteAll({ behavior: 'wait' });
  await mock(page, { empty: true });
  await page.locator('[data-promo-refresh]').click();
  await expect(page.locator('[data-promo-count]')).toHaveText('0 / 0 chương trình');
  await expect(page.locator('.promo-empty')).toContainText('được phép xem');
  await expect(page.locator('.promo-metrics strong')).toHaveText(['0', '0', '0', '0']);
});

test('chuyển bảng khi dashboard đang tải không để kết quả cũ xuất hiện ở bảng mới', async ({ page }) => {
  const api = await mock(page, { delay: true });
  await page.goto('/');
  await openDashboard(page);
  await page.getByRole('button', { name: 'branches', exact: true }).click();
  api.release();
  await expect(page.locator('#title')).toHaveText('branches');
  await expect(page.locator('#promotionsDashboard')).toBeHidden();
  await openDashboard(page);
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
});

test('refresh giữ bảng promotions, chế độ bảng dữ liệu và trang đang mở', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.getByRole('button', { name: 'Bảng dữ liệu', exact: true }).click();
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#title')).toHaveText('promotions');
  await expect(page.locator('#promotionsDashboard')).toBeHidden();
  await expect(page.locator('.grid-shell')).toBeVisible();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  // Choosing another table must not overwrite promotions' saved display mode.
  await page.getByRole('button', { name: 'branches', exact: true }).click();
  await expect(page.locator('#title')).toHaveText('branches');
  await page.reload();
  await expect(page.locator('#title')).toHaveText('branches');
  await page.getByRole('button', { name: 'promotions', exact: true }).click();
  await expect(page.locator('#promotionsDashboard')).toBeHidden();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await page.reload();
  await expect(page.locator('#promotionsDashboard')).toBeVisible();
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
});

test('dashboard chỉ xem, còn bảng dữ liệu giữ chọn dòng để quản lý', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  await expect(page.locator('#promotionsDashboard input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('#add')).toBeHidden();
  await expect(page.locator('#rowSelectionBar')).toBeHidden();
  await page.getByRole('button', { name: 'Bảng dữ liệu', exact: true }).click();
  await expect(page.locator('#add')).toBeVisible();
  await expect(page.locator('#grid input[data-row-select]').first()).toBeVisible();
  await page.locator('#grid input[data-row-select]').first().check();
  await expect(page.locator('#rowSelectionBar')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('#rowSelectionBar')).toBeHidden();
});

test('dashboard vừa màn hình điện thoại và nội dung chương trình xem được bằng bàn phím', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/');
  await openDashboard(page);
  await expect(page.locator('[data-promo-count]')).toHaveText('51 / 51 chương trình');
  const row = page.locator('[data-promo-id="promotion-50"]');
  await row.focus();
  await row.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-promo-detail]')).toContainText('Ưu đãi đã tắt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/promotions-mobile.png', fullPage: true });
});
