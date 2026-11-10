import { defineConfig, devices } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './tests/render-browsers/harness.ts';

// renderer-three in Chromium (I-11). WebGL runs on SwiftShader, a software
// rasterizer: results say nothing about frame time or GPU memory on real
// hardware (see tests/e2e/MANUAL_CHECKLIST.md and `pnpm bench:render`).
export default defineConfig({
  testDir: 'tests/render-browsers',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  projects: [
    {
      name: 'chromium-swiftshader',
      use: { ...devices['Desktop Chrome'], channel: 'chromium', headless: true, launchOptions: { args: SWIFTSHADER_ARGS } },
    },
  ],
});
