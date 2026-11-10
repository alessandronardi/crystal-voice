import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { UNTRUSTED_HTML_PROPERTIES, purityConfigs } from './tooling/eslint/purity.js';

export default tseslint.config(
  {
    name: 'voicecrystal/ignores',
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'tests/benchmarks/out/**',
      // Worktrees of parallel agent sessions: each is linted in its own checkout.
      '.claude/worktrees/**',
      // Intentionally non-conforming files, linted only by tests/lint/purity.test.ts.
      'tests/lint-fixtures/**',
      // Pre-existing review simulation, not part of the TypeScript build.
      'scripts/review/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    name: 'voicecrystal/typescript',
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
      // R17: untrusted text goes through textContent, never innerHTML.
      'no-restricted-properties': ['error', ...UNTRUSTED_HTML_PROPERTIES],
    },
  },
  {
    name: 'voicecrystal/javascript',
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    name: 'voicecrystal/extension-runtime',
    files: ['extension/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Runtime code runs in Chrome, not Node.' }] },
      ],
      'no-restricted-globals': [
        'error',
        ...['process', 'Buffer', 'require', '__dirname', '__filename'].map((name) => ({
          name,
          message: 'Runtime code runs in Chrome, not Node.',
        })),
      ],
    },
  },
  ...purityConfigs,
);
