import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Always start a fresh pair of servers. Reusing a server left behind by an
  // interrupted run can test stale code or hang on teardown.
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 30000 },
});
