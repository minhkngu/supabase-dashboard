import { test, expect } from '@playwright/test';

test('form bản ghi: trường chỉ đọc ở cuối, text ngắn một dòng, công tắc và chọn bản ghi liên kết', async ({ page }) => {
  const rooms = {
    name: 'public.rooms',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'], default_value: "nextval('rooms_id_seq')" },
      { name: 'created_at', data_type: 'timestamp with time zone', options: ['updatable', 'generated'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
      { name: 'notes', data_type: 'text', options: ['updatable', 'nullable'] },
      { name: 'is_hidden', data_type: 'boolean', options: ['updatable', 'nullable'] },
      { name: 'branchid', data_type: 'integer', options: ['updatable', 'nullable'] },
    ],
    primary_keys: ['id'],
    foreign_key_constraints: [
      {
        name: 'fk_branch',
        source_table: 'public.rooms',
        source_columns: ['branchid'],
        target_table: 'public.branches',
        target_columns: ['id'],
      },
    ],
  };
  const branches = {
    name: 'public.branches',
    columns: [
      { name: 'id', data_type: 'integer', options: ['updatable'] },
      { name: 'name', data_type: 'text', options: ['updatable'] },
    ],
    primary_keys: ['id'],
  };
  const row = {
    id: 1,
    created_at: '2026-11-01',
    name: 'Studio',
    notes: 'Dòng một\nDòng hai',
    is_hidden: false,
    branchid: 1,
  };
  let patch: Record<string, unknown> | null = null;
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: { tables: [rooms, branches], token: 't' } });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    if (url.pathname === '/api/lookup/branches') return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia' }] } });
    if (url.pathname === '/api/table/branches')
      return route.fulfill({
        json: {
          rows: [
            { id: 1, name: 'Mia' },
            { id: 2, name: 'Lune' },
          ],
          total: 2,
        },
      });
    if (request.method() === 'PATCH') {
      patch = request.postDataJSON().values;
      Object.assign(row, patch);
      return route.fulfill({ json: { rows: [row] } });
    }
    return route.fulfill({ json: { rows: [row], total: 1 } });
  });
  await page.goto('/');
  await page.locator('#grid tbody tr').first().locator('.record-index').click();
  const form = page.locator('#formFields');
  await expect(page.locator('#editor')).toBeVisible();
  const labels = await form
    .locator('.field > label')
    .evaluateAll(items => items.map(item => item.firstChild?.textContent));
  expect(labels).toEqual(['name', 'notes', 'is_hidden', 'branchid', 'id', 'created_at']);
  await expect(form.locator('#field-name')).toHaveJSProperty('tagName', 'INPUT');
  await expect(form.locator('#field-notes')).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(form.locator('.field-hint').nth(4)).not.toContainText('để trống');
  await expect(form.getByRole('switch', { name: 'is_hidden' })).not.toBeChecked();
  await form.locator('.field-switch .column-switch-slider').click();
  await expect(form.getByRole('switch', { name: 'is_hidden' })).toBeChecked();
  await expect(form.locator('.field-switch-state')).toHaveText('Có (true)');
  await form.getByRole('button', { name: 'branchid' }).click();
  await page.locator('.custom-select-menu:not([hidden])').getByRole('option', { name: 'Lune' }).click();
  await page.locator('#save').click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(patch).toEqual({ is_hidden: true, branchid: 2 });
});
