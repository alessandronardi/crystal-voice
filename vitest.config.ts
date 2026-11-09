import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node only: pure packages must run without a DOM (AGENTS.md R10).
    environment: 'node',
    include: [
      'packages/*/test/**/*.test.ts',
      'extension/test/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/lint/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'tests/lint-fixtures/**'],
  },
});
