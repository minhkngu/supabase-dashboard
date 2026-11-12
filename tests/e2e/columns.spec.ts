import { test, expect } from '@playwright/test';

test('mở bảng trực tiếp và giữ thiết lập cột', async ({ page }) => {
  let name = 'Mia';
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: false,
        },
      });
      return;
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      if (body.expected && body.expected.name !== name) {
        await route.fulfill({ status: 409, json: { error: 'Bản ghi đã thay đổi' } });
        return;
      }
      name = body.values.name;
      await route.fulfill({ json: { rows: [{ id: 1, name }] } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, name }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('tbody')).toContainText('1');
  await page.locator('td.cell-editable').filter({ hasText: 'Mia' }).click();
  await page.locator('td.editing input').fill('Lune');
  await page.locator('td.editing input').press('Enter');
  await expect(page.locator('tbody')).toContainText('Lune');
  await page.locator('#undoCell').click();
  await expect(page.locator('tbody')).toContainText('Mia');
  await page.locator('#redoCell').click();
  await expect(page.locator('tbody')).toContainText('Lune');
  await page.locator('#undoCell').click();
  await expect(page.locator('tbody')).toContainText('Mia');
  await page.locator('#columnsButton').click();
  await page.locator('#columnVisibility label').filter({ hasText: 'name' }).click();
  await expect(page.locator('thead')).not.toContainText('name');
  await page.reload();
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('thead')).not.toContainText('name');
});

test('quản lý cột lưu sau khi kiểm tra mà không hỏi lại', async ({ page }) => {
  let changed = false,
    previewCount = 0,
    applyCount = 0;
  const metadata = () => ({
    tables: [
      {
        name: 'public.demo',
        columns: [
          { name: 'id', data_type: 'integer', options: ['updatable'] },
          { name: changed ? 'memo' : 'note', data_type: 'text', options: ['updatable', 'nullable'] },
        ],
        primary_keys: ['id'],
      },
    ],
    token: 'csrf',
    adminAvailable: true,
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({ json: metadata() });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      previewCount++;
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 2 } });
      return;
    }
    if (url.pathname === '/api/admin/schema/apply') {
      applyCount++;
      expect(req.postDataJSON().operation).toMatchObject({ action: 'rename', column: 'note', newName: 'memo' });
      changed = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, [changed ? 'memo' : 'note']: 'A' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('thead')).toContainText('note');
  await page.getByRole('button', { name: 'Thiết lập cột note' }).click();
  await page.locator('#columnName').fill('memo');
  await page.locator('#saveColumn').click();
  await expect(page.locator('thead')).toContainText('memo');
  expect(previewCount).toBe(1);
  expect(applyCount).toBe(1);
});

test('thêm cột mở trực tiếp hộp thoại', async ({ page }) => {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [{ name: 'id', data_type: 'integer', options: ['updatable'] }],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1 }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await expect(page.locator('#manageLookups')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thêm cột', exact: true }).click();
  await expect(page.locator('#columnDialog')).toBeVisible();
  await expect(page.locator('#chooseLookup')).toHaveCount(0);
});

test('tạo cột hiển thị tùy chọn và xem trước cấu hình', async ({ page }) => {
  let preview: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [{ name: 'id', data_type: 'integer', options: ['updatable'] }],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      preview = req.postDataJSON();
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 0 } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1 }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('demo');
  await page.getByRole('button', { name: 'Thêm cột', exact: true }).click();
  await page.locator('#columnName').fill('code');
  await page.locator('#columnType').selectOption('uuid');
  await page.locator('#columnDefaultKind').selectOption('uuid');
  await page.locator('#columnUnique').check();
  await page.locator('#columnDescription').fill('Mã nhận diện');
  await page.locator('#saveColumn').click();
  await expect.poll(() => preview).toBeDefined();
  expect(preview).toMatchObject({
    action: 'add',
    newName: 'code',
    newType: 'uuid',
    options: { nullable: true, unique: true, identity: false, defaultKind: 'uuid', description: 'Mã nhận diện' },
  });
});

test('đổi kiểu cột đã tạo và hiển thị lỗi chuyển kiểu', async ({ page }) => {
  let apply = 0,
    fail = true;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/api/meta') {
      await route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'amount', data_type: apply ? 'integer' : 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
          adminAvailable: true,
        },
      });
      return;
    }
    if (url.pathname === '/api/lookup-config') {
      await route.fulfill({ json: { available: false, items: [] } });
      return;
    }
    if (url.pathname === '/api/admin/schema/preview') {
      expect(req.postDataJSON()).toMatchObject({ action: 'type', column: 'amount', newType: 'integer' });
      if (fail) {
        await route.fulfill({ status: 400, json: { error: 'Có dữ liệu không thể chuyển sang kiểu đã chọn.' } });
        return;
      }
      await route.fulfill({ json: { signature: 'a'.repeat(64), affected: 1 } });
      return;
    }
    if (url.pathname === '/api/admin/schema/apply') {
      apply++;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { rows: [{ id: 1, amount: '123' }], total: 1 } });
  });
  await page.goto('/');
  await expect(page.locator('thead')).toContainText('amount');
  await page.getByRole('button', { name: 'Thiết lập cột amount' }).click();
  await expect(page.locator('#columnKind')).toBeHidden();
  await page.locator('#columnType').selectOption('integer');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnError')).toContainText('không thể chuyển');
  expect(apply).toBe(0);
  fail = false;
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  await expect.poll(() => apply).toBe(1);
});

test('kéo sắp xếp cột trong danh sách và giữ thứ tự sau tải lại', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('siris-views-v1'))
      localStorage.setItem('siris-views-v1', JSON.stringify({ demo: { frozen: [], freezeDefaultInitialized: true } }));
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'note', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({ json: { rows: [{ id: 1, name: 'Mia', note: 'A' }], total: 1 } });
  });
  await page.goto('/');
  await page.locator('#columnsButton').click();
  const item = (name: string) =>
    page
      .locator('#columnVisibility .column-visibility-item')
      .filter({ has: page.getByRole('button', { name: `Sắp xếp cột ${name}` }) });
  await item('note').dragTo(item('name'), { targetPosition: { x: 30, y: 2 } });
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:note', 'col:name']);
  await expect(item('note').locator('input')).toBeChecked();
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:note', 'col:name']);
  await page.locator('#columnsButton').click();
  await page.getByRole('button', { name: 'Sắp xếp cột name' }).press('ArrowUp');
  await expect
    .poll(() =>
      page
        .locator('#grid thead th[data-column-id]')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-column-id'))),
    )
    .toEqual(['col:id', 'col:name', 'col:note']);
});

test('thiết lập cột hiển thị kiểu Supabase và lý do cột được bảo vệ', async ({ page }) => {
  let previews = 0;
  const columns = [
    { name: 'id', data_type: 'uuid', format: 'uuid', options: ['updatable'], protected: true },
    { name: 'amount', data_type: 'numeric', format: 'numeric(12,2)', options: ['updatable', 'nullable'] },
    { name: 'tags', data_type: '_text', format: 'text[]', options: ['updatable', 'nullable'] },
    {
      name: 'status',
      data_type: 'booking_status',
      format: 'booking_status',
      enum_values: ['new', 'done'],
      options: ['updatable'],
    },
    { name: 'code', data_type: 'text', format: 'text', options: ['updatable'], protected: true },
  ];
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: { tables: [{ name: 'public.demo', columns, primary_keys: ['id'] }], token: 'csrf', adminAvailable: true },
      });
    if (path === '/api/admin/schema/preview') {
      previews++;
      return route.fulfill({ json: { signature: 'a'.repeat(64), affected: 0 } });
    }
    return route.fulfill({
      json: { rows: [{ id: 'a', amount: '2.00', tags: [], status: 'new', code: 'x' }], total: 1 },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Thiết lập cột id' }).click();
  await expect(page.locator('#columnType')).toHaveValue('__current__');
  await expect(page.locator('#columnType')).toBeEnabled();
  await expect(page.locator('#columnTypeInfo')).toContainText('khóa chính');
  await expect(page.locator('#deleteColumn')).toBeDisabled();
  await page.locator('#cancelColumn').click();
  for (const [column, actual] of [
    ['amount', 'numeric(12,2)'],
    ['tags', 'text[]'],
    ['status', 'booking_status'],
  ]) {
    await page.getByRole('button', { name: `Thiết lập cột ${column}` }).click();
    await expect(page.locator('#columnType option:checked')).toContainText(actual);
    await expect(page.locator('#columnType')).toBeEnabled();
    await page.locator('#saveColumn').click();
    expect(previews).toBe(0);
    await expect(page.locator('#columnDialog')).toBeHidden();
  }
  await page.getByRole('button', { name: 'Thiết lập cột code' }).click();
  await expect(page.locator('#columnTypeInfo')).toContainText('ràng buộc');
  await expect(page.locator('#columnName')).toBeDisabled();
});

test('ẩn và hiện cột cập nhật hàng dữ liệu ngay và giữ menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/formula-config')
      return route.fulfill({ json: { items: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookup-config')
      return route.fulfill({ json: { available: false, items: [] } });
    if (new URL(route.request().url()).pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: [
                { name: 'id', data_type: 'integer', options: ['updatable'] },
                { name: 'name', data_type: 'text', options: ['updatable'] },
                { name: 'note', data_type: 'text', options: ['updatable'] },
              ],
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    return route.fulfill({
      json: {
        rows: [
          { id: 1, name: 'Mia', note: 'A' },
          { id: 2, name: 'Lune', note: 'B' },
        ],
        total: 2,
      },
    });
  });
  await page.goto('/');
  await page.locator('#columnsButton').click();
  const menu = page.locator('#columnsMenu'),
    item = page.locator('#columnVisibility label').filter({ hasText: 'name' });
  await item.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('th[data-column-id="col:name"]')).toHaveCount(0);
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveCount(0);
  await expect(page.locator('td[data-bulk-column="note"]')).toHaveText(['A', 'B']);
  await expect(page.locator('#hiddenColumnCount')).toHaveText('1');
  await item.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText(['Mia', 'Lune']);
  await expect(page.locator('#hiddenColumnCount')).toHaveText('');
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.locator('td[data-bulk-column="name"]')).toHaveText(['Mia', 'Lune']);
});

test('formula lưu nền, bảo vệ ô và giữ giá trị khi tắt', async ({ page }) => {
  let configs: { table: string; column: string; expression: string; enabled: boolean }[] = [];
  let value = 15;
  let fail = false;
  const col = (name: string) => ({ name, data_type: 'numeric', format: 'numeric', options: ['updatable', 'nullable'] });
  await page.route('**/api/**', async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          tables: [{ name: 'public.rooms', columns: [col('id'), col('price'), col('total')], primary_keys: ['id'] }],
          token: 'csrf',
          adminAvailable: true,
        },
      });
    if (path === '/api/lookup-config') return route.fulfill({ json: { available: true, items: [] } });
    if (path === '/api/formula-config' && req.method() === 'GET') return route.fulfill({ json: { items: configs } });
    if (path === '/api/formula-config') {
      if (fail) return route.fulfill({ status: 400, json: { error: 'Công thức không hợp lệ.' } });
      const config = req.postDataJSON();
      configs = [config];
      if (config.enabled) value = 20;
      return route.fulfill({ json: { config } });
    }
    if (path === '/api/table/rooms')
      return route.fulfill({ json: { rows: [{ id: 1, price: 10, total: value }], total: 1 } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('rooms');
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await page.locator('#columnFormulaEnabled').check();
  await page.locator('#columnFormulaField').selectOption('price');
  await expect(page.locator('#columnFormulaExpression')).toHaveValue('[price]');
  await page.locator('#columnFormulaExpression').fill('[price] * 2');
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeHidden();
  const cell = page.locator('td[data-bulk-column="total"]');
  await expect(cell).toHaveText('20');
  await expect(cell).toHaveClass(/cell-readonly/);
  await page.reload();
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await expect(page.locator('#columnFormulaEnabled')).toBeChecked();
  await page.locator('#columnFormulaEnabled').uncheck();
  await page.locator('#saveColumn').click();
  await expect(cell).toHaveClass(/cell-editable/);
  await expect(cell).toHaveText('20');
  await page.getByRole('button', { name: 'Thiết lập cột total', exact: true }).click();
  await page.locator('#columnFormulaEnabled').check();
  await page.locator('#columnFormulaExpression').fill('[price] / 0');
  fail = true;
  await page.locator('#saveColumn').click();
  await expect(page.locator('#columnDialog')).toBeVisible();
  await expect(page.locator('#columnError')).toContainText('Công thức không hợp lệ');
  await expect(page.locator('#columnFormulaExpression')).toHaveValue('[price] / 0');
});

test('kéo cột: vạch báo đúng mép sẽ chèn và chặn kéo qua ranh giới ghim', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta')
      return route.fulfill({
        json: {
          tables: [
            {
              name: 'public.demo',
              columns: ['id', 'name', 'note'].map(n => ({ name: n, data_type: 'text', options: ['updatable'] })),
              primary_keys: ['id'],
            },
          ],
          token: 'csrf',
        },
      });
    if (url.pathname === '/api/formula-config') return route.fulfill({ json: { items: [] } });
    if (url.pathname === '/api/lookup-config') return route.fulfill({ json: { available: false, items: [] } });
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  await page.goto('/');
  const header = (n: string) => page.locator(`th[data-column-id="col:${n}"]`);
  await expect(header('note')).toBeVisible();
  const drag = (from: string, to: string, ratio: number, type: 'dragover' | 'drop') =>
    page.evaluate(
      ([f, t, r, ty]) => {
        const source = document.querySelector(`th[data-column-id="col:${f}"]`)!,
          target = document.querySelector(`th[data-column-id="col:${t}"]`)!,
          rect = target.getBoundingClientRect(),
          data = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
        target.dispatchEvent(
          new DragEvent(ty as string, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientX: rect.left + rect.width * (r as number),
            clientY: rect.top + 5,
          }),
        );
        if (ty === 'dragover') return target.className;
        return '';
      },
      [from, to, ratio, type] as const,
    );
  expect(await drag('id', 'note', 0.25, 'dragover')).toContain('column-drop-before');
  expect(await drag('id', 'note', 0.75, 'dragover')).toContain('column-drop-after');
  await drag('id', 'note', 0.75, 'drop');
  await expect(page.locator('th[data-column-id]').last()).toHaveAttribute('data-column-id', 'col:id');
  // "name" is pinned by default; dragging an unpinned column over it is refused.
  expect(await drag('note', 'name', 0.75, 'dragover')).not.toContain('column-drop');
});
