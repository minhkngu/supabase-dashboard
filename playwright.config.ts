import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  // Half the cores (the default) starts more pages than one Vite dev server answers within the
  // 15 s limit on a many-core machine, so local runs stop at six. CI keeps the default.
  workers: process.env.CI ? undefined : Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))),
  // One character per test for CI and coding agents; the per-test list is for people at a terminal.
  reporter: process.env.CI || process.env.CLAUDECODE ? 'dot' : 'list',
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
