import { test, expect } from '@playwright/test';

test('không phục vụ tệp cấu hình môi trường', async ({ request }) => {
  const response = await request.get('/.env.local');
  expect(response.status()).toBeGreaterThanOrEqual(400);
});
