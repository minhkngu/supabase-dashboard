import { test, expect, type Page } from '@playwright/test';

const table = {
  name: 'public.demo',
  columns: [
    { name: 'id', data_type: 'integer', options: ['updatable'] },
    { name: 'name', data_type: 'text', options: ['updatable'] },
  ],
  primary_keys: ['id'],
};
const other = { ...table, name: 'public.other' };

// Deleting asks for confirmation in the in-page dialog.
const confirmDelete = (page: Page) =>
  page
    .locator('#confirmDialog')
    .getByRole('button', { name: /^Xóa \d+ dòng$/ })
    .click();

async function mock(
  page: Page,
  { refreshFails = false, blockedId = 0, delayDelete = false, count = 3, otherCount = 1, networkId = 0 } = {},
) {
  let data = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Dòng ${i + 1}` }));
  const deletes: number[] = [];
  let release = () => {};
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/**', async route => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [table, other], token: 'csrf' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (req.method() === 'DELETE') {
      const id = req.postDataJSON().key.id;
      deletes.push(id);
      if (delayDelete) await blocked;
      if (id === networkId) return route.abort('failed');
      if (id === blockedId)
        return route.fulfill({ status: 400, json: { error: 'Bản ghi đang được tham chiếu bởi bảng khác.' } });
      const removed = data.filter(row => row.id === id);
      data = data.filter(row => row.id !== id);
      return route.fulfill({ json: { rows: removed } });
    }
    const start = Number(url.searchParams.get('page') || 0) * 50;
    if (url.pathname === '/api/table/other')
      return route.fulfill({
        json: {
          rows: Array.from({ length: otherCount }, (_, i) => ({ id: i + 1, name: `Bảng khác ${i + 1}` })).slice(
            start,
            start + 50,
          ),
          total: otherCount,
        },
      });
    if (refreshFails && deletes.length)
      return route.fulfill({ status: 503, json: { error: 'Không tải được dữ liệu mới' } });
    return route.fulfill({ json: { rows: data.slice(start, start + 50), total: data.length } });
  });
  return { deletes, release };
}

test('xóa thành công phải bỏ dòng khỏi giao diện kể cả khi làm mới dữ liệu thất bại', async ({ page }) => {
  const api = await mock(page, { refreshFails: true });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(3);
  await page.locator('td.record-detail').first().click();
  await page.locator('#delete').click();
  await confirmDelete(page);
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#grid tbody tr')).toHaveCount(2);
  await expect(page.locator('#grid')).not.toContainText('Dòng 1');
  expect(api.deletes).toEqual([1]);
});

test('chọn nhiều dòng để xóa, thành công từng phần giữ dòng lỗi và mở lại các nút', async ({ page }) => {
  const api = await mock(page, { blockedId: 2 });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Chọn tất cả dòng hiển thị trên trang', exact: true }).check();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#rowSelectionSummary')).toHaveText('Đã chọn 3 dòng');
  await page.locator('#deleteSelectedRows').click();
  await confirmDelete(page);
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await expect(page.locator('#grid')).toContainText('Dòng 2');
  await expect(page.locator('#rowDeleteResults')).toContainText('Đã xóa 2/3 dòng');
  await expect(page.locator('#rowDeleteResults')).toContainText('đang được tham chiếu');
  await expect(page.locator('#deleteSelectedRows')).toBeEnabled();
  await expect(page.locator('#rowSelectionSummary')).toHaveText('Đã chọn 1 dòng');
  expect(api.deletes).toEqual([1, 2, 3]);
  await page.screenshot({ path: 'test-results/delete-selection-desktop.png', fullPage: true });
  await page.locator('#clearRowSelection').click();
  await expect(page.locator('#rowSelectionBar')).toBeHidden();
});

test('hủy xác nhận không xóa; một dòng được chọn có thể xóa mà không mở editor', async ({ page }) => {
  const api = await mock(page);
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Chọn dòng 2', exact: true }).check();
  await page.locator('#deleteSelectedRows').click();
  await expect(page.locator('#confirmDialog')).toContainText('Xóa 1 dòng?');
  await page.locator('#confirmDialog').getByRole('button', { name: 'Hủy' }).click();
  await expect(page.locator('#grid tbody tr')).toHaveCount(3);
  expect(api.deletes).toEqual([]);
  await expect(page.locator('#deleteSelectedRows')).toBeEnabled();
  await page.locator('#deleteSelectedRows').click();
  await confirmDelete(page);
  await expect(page.locator('#grid tbody tr')).toHaveCount(2);
  await expect(page.locator('#grid')).not.toContainText('Dòng 2');
  expect(api.deletes).toEqual([2]);
});

test('xóa dòng cuối trang quay về trang còn dữ liệu, không giữ trang rỗng', async ({ page }) => {
  await mock(page, { count: 51 });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await page.locator('#next').click();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await page.getByRole('checkbox', { name: 'Chọn dòng 51', exact: true }).check();
  await page.locator('#deleteSelectedRows').click();
  await confirmDelete(page);
  await expect(page.locator('#page')).toHaveText('Trang 1');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await expect(page.locator('#count')).toHaveText('50 bản ghi');
});

test('xóa đang chạy khóa nút gửi lặp và không thay đổi bảng mới khi chuyển bảng', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('siris-views-v1', JSON.stringify({ other: { page: 1 } })));
  const api = await mock(page, { delayDelete: true, otherCount: 51 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Chọn dòng 1', exact: true }).check();
  await page.locator('#deleteSelectedRows').click();
  await confirmDelete(page);
  await expect(page.locator('#deleteSelectedRows')).toBeDisabled();
  await expect(page.locator('#rowSelectionSummary')).toContainText('Đang xóa 1/1');
  await page.getByRole('button', { name: 'other', exact: true }).click();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  api.release();
  await expect(page.locator('#rowSelectionBar')).toBeHidden();
  await expect(page.locator('#title')).toHaveText('other');
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await expect(page.locator('#count')).toHaveText('51 bản ghi');
  await expect(page.locator('#grid')).toContainText('Bảng khác 51');
  expect(api.deletes).toEqual([1]);
});

test('lỗi mạng dừng lô xóa và báo kết quả chưa xác định, không tự gửi lại', async ({ page }) => {
  const api = await mock(page, { networkId: 1 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Chọn tất cả dòng hiển thị trên trang', exact: true }).check();
  await page.locator('#deleteSelectedRows').click();
  await confirmDelete(page);
  await expect(page.locator('#rowDeleteResults')).toContainText('Chưa xác nhận được kết quả xóa');
  await expect(page.locator('#rowDeleteResults')).toContainText('2 dòng chưa được gửi');
  await expect(page.locator('#grid tbody tr')).toHaveCount(3);
  await expect(page.locator('#deleteSelectedRows')).toBeEnabled();
  expect(api.deletes).toEqual([1]);
});
