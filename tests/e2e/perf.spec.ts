import { test, expect } from '@playwright/test';

const table = {
  name: 'public.demo',
  columns: [
    { name: 'id', data_type: 'integer', options: ['updatable'] },
    { name: 'name', data_type: 'text', options: ['updatable'] },
  ],
  primary_keys: ['id'],
};

const common = (path: string) => {
  if (path === '/api/formula-config') return { json: { items: [] } };
  if (path === '/api/lookup-config') return { json: { available: false, items: [] } };
  return null;
};

test('dựng lưới từ metadata lưu trước khi /api/meta trả lời', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.addInitScript(saved => {
    localStorage.setItem('siris-metadata-v1', JSON.stringify({ tables: [saved] }));
    localStorage.setItem('siris-current-table', 'demo');
  }, table);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const fixed = common(path);
    if (fixed) return route.fulfill(fixed);
    if (path === '/api/meta') {
      await blocked;
      return route.fulfill({ json: { tables: [table], token: 'csrf' } });
    }
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Mia');
  release();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Mia');
});

test('tìm từ hai ký tự, đếm sau khi dừng gõ và tìm trong một cột', async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const fixed = common(url.pathname);
    if (fixed) return route.fulfill(fixed);
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [table], token: 'csrf' } });
    requests.push(url.searchParams);
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Mia');
  const before = requests.length;
  await page.locator('#search').fill('m');
  await expect(page.locator('#message')).toHaveText('Nhập ít nhất 2 ký tự để tìm kiếm.');
  expect(requests.length).toBe(before);
  await page.locator('#search').fill('mi');
  await expect.poll(() => requests.length).toBeGreaterThan(before);
  // The first preview skips the exact count; the debounced pass requests it.
  expect(requests.at(-1)?.get('count')).toBe('none');
  await expect.poll(() => requests.some(q => q.get('search') === 'mi' && q.get('count') === null)).toBe(true);
  await page.locator('#searchColumn').selectOption('name');
  await expect.poll(() => requests.at(-1)?.get('search_column')).toBe('name');
  expect(requests.at(-1)?.get('count')).toBeNull();
});

test('quay lại trang đã xem hiện ngay trong khi làm mới ở nền', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  let pageZeroReads = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const fixed = common(url.pathname);
    if (fixed) return route.fulfill(fixed);
    if (url.pathname === '/api/meta')
      return route.fulfill({ json: { tables: [{ ...table, columns: [...table.columns] }], token: 'csrf' } });
    if (url.pathname === '/api/table/demo') {
      const p = Number(url.searchParams.get('page') || 0);
      if (p === 0) {
        pageZeroReads++;
        if (pageZeroReads > 1) await blocked;
        return route.fulfill({ json: { rows: [{ id: 1, name: 'Trang một' }], total: 60 } });
      }
      return route.fulfill({ json: { rows: [{ id: 2, name: 'Trang hai' }], total: 60 } });
    }
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Trang một');
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Trang hai');
  await page.getByRole('button', { name: 'Trang trước', exact: true }).click();
  // The cached page is drawn before the blocked background refresh returns.
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Trang một');
  await expect.poll(() => pageZeroReads).toBeGreaterThan(1);
  release();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Trang một');
});
