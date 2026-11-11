import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createVercelHandler } from '../../server/vercel.mjs';
let server: ReturnType<typeof createServer>;
let base: string;
const password = 'local-test-password-long-enough';
test.beforeAll(async () => {
  const handler = await createVercelHandler(
    { SIRIS_AUTH_LOCAL: '1', SIRIS_LOGIN_USER: 'siris', SIRIS_LOGIN_PASSWORD: password },
    [],
    process.cwd(),
  );
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing server address');
  base = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});
for (const width of [390, 768, 1440]) {
  test(`đăng nhập một lần, báo lỗi rõ và giữ phiên ở ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await expect(page).toHaveURL(base + '/auth/login');
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/login-${width}.png` });
    await page.getByLabel('Tên đăng nhập').fill('siris');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Tên đăng nhập hoặc mật khẩu chưa đúng');
    await page.getByLabel('Tên đăng nhập').fill('siris');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('#tables')).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(base + '/');
    const response = await page.request.get(base + '/api/meta');
    expect(response.status()).toBe(200);
    expect((await response.json()).tables).toEqual([]);
  });
}
