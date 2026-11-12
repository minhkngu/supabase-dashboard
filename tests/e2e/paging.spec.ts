import { test, expect } from '@playwright/test';

const columns = ['id', 'name'].map(name => ({
  name,
  data_type: name === 'id' ? 'integer' : 'text',
  options: ['updatable'],
}));
const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: i < 60 ? `Mia ${i + 1}` : `Lune ${i + 1}` }));

test('chuyển trang dùng lại tổng đã biết, đổi tìm kiếm thì đếm lại', async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    requests.push(url.searchParams);
    const search = url.searchParams.get('search') || '',
      matches = rows.filter(row => row.name.toLowerCase().includes(search.toLowerCase())),
      p = Number(url.searchParams.get('page') || 0);
    const total = url.searchParams.get('count') === '0' ? null : matches.length;
    return route.fulfill({ json: { rows: matches.slice(p * 50, p * 50 + 50), total } });
  });
  await page.goto('/');
  await expect(page.locator('#count')).toHaveText('120 bản ghi');
  expect(requests.at(-1)?.get('count')).toBeNull();
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  expect(requests.at(-1)?.get('count')).toBe('0');
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('#page')).toHaveText('Trang 3');
  await expect(page.locator('#grid tbody tr')).toHaveCount(20);
  await expect(page.locator('#count')).toHaveText('120 bản ghi');
  await expect(page.getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled();
  await page.locator('#search').fill('lune');
  await expect(page.locator('#count')).toHaveText('60 bản ghi');
  expect(requests.at(-1)?.get('count')).toBeNull();
});

test('chọn cỡ trang ở chân lưới và nhớ theo bảng', async ({ page }) => {
  const limits: (string | null)[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    const limit = Number(url.searchParams.get('limit') || 50),
      p = Number(url.searchParams.get('page') || 0);
    limits.push(url.searchParams.get('limit'));
    return route.fulfill({ json: { rows: rows.slice(p * limit, p * limit + limit), total: rows.length } });
  });
  await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('#page')).toHaveText('Trang 2');
  await page.getByRole('button', { name: 'Số dòng mỗi trang' }).click();
  await page.locator('.custom-select-menu:not([hidden])').getByRole('option', { name: '100 dòng' }).click();
  // Row 51 was first on screen, so the 100-row page that contains it opens.
  await expect(page.locator('#page')).toHaveText('Trang 1');
  await expect(page.locator('#grid tbody tr')).toHaveCount(100);
  expect(limits.at(-1)).toBe('100');
  await page.reload();
  await expect(page.locator('#grid tbody tr')).toHaveCount(100);
  await expect(page.getByRole('button', { name: 'Số dòng mỗi trang' })).toContainText('100 dòng');
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('#grid tbody tr')).toHaveCount(20);
});
