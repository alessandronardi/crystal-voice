import { defineConfig } from '@playwright/test';

// E2E with the real extension loaded (see tests/e2e/README.md).
// Extensions need a persistent context, created inside each test.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
});
