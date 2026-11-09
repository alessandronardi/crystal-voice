// Proves that the purity rules (AGENTS.md R10, R11, R17; ADR-0010) actually fire.
// Each fixture in tests/lint-fixtures/ is linted as if it lived inside a
// protected directory, with the same rule objects used by eslint.config.js.
//
// Convention: every fixture line ending in a `// ✗` comment must be reported
// by at least one rule, and no other line may be reported.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MATH_MEMBERS,
  FORBIDDEN_MATH_MEMBERS,
  PURE_PACKAGES,
  purityConfigs,
} from '../../tooling/eslint/purity.js';

const ROOT = resolve(import.meta.dirname, '../..');
const FIXTURES = join(ROOT, 'tests/lint-fixtures');
const MARK = '// ✗';

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,mts,cts,tsx,js,mjs,cjs}'],
      languageOptions: { parser: tseslint.parser },
    },
    ...purityConfigs,
  ],
});

interface Outcome {
  expected: number[];
  reported: number[];
  messages: Linter.LintMessage[];
}

async function lint(fixture: string, target: string): Promise<Outcome> {
  const code = readFileSync(join(FIXTURES, fixture), 'utf8');
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, target) });
  if (!result) throw new Error('ESLint returned no result');
  const fatal = result.messages.filter((m) => m.fatal === true);
  expect(fatal, `parse errors in ${fixture}`).toEqual([]);
  const expected = code
    .split(/\r?\n/)
    .flatMap((line, i) => (line.trimEnd().endsWith(MARK) ? [i + 1] : []));
  const reported = [...new Set(result.messages.map((m) => m.line))].sort((a, b) => a - b);
  return { expected, reported, messages: result.messages };
}

async function expectMarkedLinesReported(fixture: string, target: string): Promise<Outcome> {
  const outcome = await lint(fixture, target);
  expect(outcome.expected.length, `${fixture} has no ${MARK} markers`).toBeGreaterThan(0);
  expect(outcome.reported, `${fixture} linted as ${target}`).toEqual(outcome.expected);
  return outcome;
}

async function expectClean(fixture: string, target: string): Promise<void> {
  const { messages } = await lint(fixture, target);
  expect(messages, `${fixture} linted as ${target}`).toEqual([]);
}

const PURE = 'packages/dsp-core/src/__fixture__.ts';
const CRYSTAL_CORE = 'packages/crystal-core/src/appearance.ts';
const GEOMETRY = 'packages/crystal-core/src/geometry/__fixture__.ts';

describe('pure packages (R10)', () => {
  it('reject browser, extension and Node globals', async () => {
    await expectMarkedLinesReported('pure-uses-globals.ts', PURE);
  });

  it('reject Three.js, Node built-ins and impure code', async () => {
    await expectMarkedLinesReported('pure-imports.ts', 'packages/comparator/src/a/b.ts');
  });

  it.each(PURE_PACKAGES)('apply to packages/%s/src', async (pkg) => {
    await expectMarkedLinesReported('pure-uses-globals.ts', `packages/${pkg}/src/x.ts`);
  });

  it.each(['mts', 'cts', 'tsx', 'js', 'mjs'])('apply to .%s files too', async (ext) => {
    await expectMarkedLinesReported('pure-uses-globals.ts', `packages/dsp-core/src/x.${ext}`);
  });

  it('do not apply to the extension or to impure packages', async () => {
    await expectClean('pure-uses-globals.ts', 'extension/src/x.ts');
    await expectClean('pure-imports.ts', 'packages/renderer-three/src/x.ts');
  });

  it('do not apply to tests inside a pure package', async () => {
    await expectClean('pure-imports.ts', 'packages/dsp-core/test/x.test.ts');
  });
});

describe('crystal-core outside the vertex path (R11)', () => {
  it('rejects randomness, clocks and mutable module state', async () => {
    await expectMarkedLinesReported('crystal-core-nondeterminism.ts', CRYSTAL_CORE);
  });

  it('applies to crystal-core/src/index.ts as well', async () => {
    await expectMarkedLinesReported('crystal-core-nondeterminism.ts', 'packages/crystal-core/src/index.ts');
  });

  it('allows randomness in other pure packages (only crystal-core is constrained)', async () => {
    await expectClean('crystal-core-nondeterminism.ts', PURE);
  });
});

describe('crystal-core vertex path (R11, ADR-0010)', () => {
  it('rejects engine-dependent Math, **, clocks and crypto', async () => {
    await expectMarkedLinesReported('geometry-forbidden-math.ts', GEOMETRY);
  });

  it('rejects every known way of reaching Math indirectly', async () => {
    await expectMarkedLinesReported('geometry-bypass-attempts.ts', GEOMETRY);
  });

  it('rejects imports from outside geometry/ except the listed exact tables', async () => {
    await expectMarkedLinesReported('geometry-imports.ts', GEOMETRY);
  });

  it('keeps the R17 rule that the geometry block overrides', async () => {
    await expectMarkedLinesReported('geometry-untrusted-html.ts', GEOMETRY);
  });

  it('still enforces the pure-package and crystal-core rules', async () => {
    await expectMarkedLinesReported('pure-uses-globals.ts', GEOMETRY);
    // Here Math.sin (unmarked, legal outside geometry/) is reported too: only
    // check that every marked line is among the reported ones.
    const { expected, reported } = await lint('crystal-core-nondeterminism.ts', GEOMETRY);
    expect(reported).toEqual(expect.arrayContaining(expected));
  });

  it('applies to nested folders and other extensions', async () => {
    await expectMarkedLinesReported(
      'geometry-forbidden-math.ts',
      'packages/crystal-core/src/geometry/deep/x.mts',
    );
  });

  it('accepts + - * /, Math.sqrt and exact constants', async () => {
    await expectClean('geometry-conforming.ts', GEOMETRY);
  });

  it('covers every member named in the I-01 DoD and allows sqrt', () => {
    for (const member of ['random', 'sin', 'cos', 'tan', 'atan2', 'exp', 'pow', 'log']) {
      expect(FORBIDDEN_MATH_MEMBERS).toContain(member);
      expect(ALLOWED_MATH_MEMBERS).not.toContain(member);
    }
    expect(ALLOWED_MATH_MEMBERS).toContain('sqrt');
  });
});

describe('eslint.config.js wiring', () => {
  const real = new ESLint({ cwd: ROOT });
  const rulesFor = async (path: string): Promise<string> => {
    const config = (await real.calculateConfigForFile(join(ROOT, path))) as Linter.Config;
    return JSON.stringify(config.rules ?? {});
  };

  it('enables the vertex-path rules for crystal-core/src/geometry', async () => {
    const rules = await rulesFor(GEOMETRY);
    expect(rules).toContain('"property":"sin"');
    expect(rules).toContain('"property":"innerHTML"');
  });

  it('enables the crystal-core rules for the whole package', async () => {
    expect(await rulesFor('packages/crystal-core/src/index.ts')).toContain('"name":"Date"');
  });

  it('enables the pure-package rules for every pure package', async () => {
    for (const pkg of PURE_PACKAGES) {
      expect(await rulesFor(`packages/${pkg}/src/index.ts`)).toContain('"name":"chrome"');
    }
  });
});
