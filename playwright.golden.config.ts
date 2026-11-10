import { defineConfig, devices } from '@playwright/test';

// Golden geometry hashes in real browsers (I-10). Separate from the extension
// E2E config: plain pages, no extension, headless.
export default defineConfig({
  testDir: 'tests/golden-browsers',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', headless: true } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: true } },
  ],
});
