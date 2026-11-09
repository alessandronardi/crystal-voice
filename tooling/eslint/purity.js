// Purity rules (AGENTS.md R10, R11, R17; ADR-0010). Shared by eslint.config.js
// and by tests/lint/purity.test.ts, so the test exercises the very same objects.
//
import { builtinModules } from 'node:module';

// Flat config: a later block that sets the same rule REPLACES its options.
// Every block below therefore carries the full option list for each rule it
// sets, built from the shared lists in this file.

/** Packages that must run in Node and in workers with no chrome.*, DOM or Three.js. */
export const PURE_PACKAGES = [
  'contracts',
  'dsp-core',
  'calibration',
  'crystal-core',
  'renderer-svg',
  'comparator',
];

/** Every source extension, so `.mts`, `.js` and friends cannot dodge the rules. */
const EXT = '{ts,mts,cts,tsx,js,mjs,cjs,jsx}';

export const PURE_SOURCE_GLOBS = PURE_PACKAGES.map((name) => `packages/${name}/src/**/*.${EXT}`);
export const CRYSTAL_CORE_SOURCE_GLOBS = [`packages/crystal-core/src/**/*.${EXT}`];
export const GEOMETRY_SOURCE_GLOBS = [`packages/crystal-core/src/geometry/**/*.${EXT}`];

// ---------------------------------------------------------------- messages

const R10 = 'Pure packages must not use browser, extension or Node APIs (AGENTS.md R10).';
const R11 = 'crystal-core must be deterministic: no randomness, clocks or global state (AGENTS.md R11).';
const VERTEX =
  'Forbidden in the crystal-core vertex path: use + - * / and Math.sqrt only (ADR-0010, AGENTS.md R11).';
const R17 = 'Untrusted text goes through textContent (AGENTS.md R17).';

// ----------------------------------------------------------------- globals

const PURE_RESTRICTED_GLOBALS = [
  'chrome',
  'browser',
  'window',
  'document',
  'self',
  'globalThis',
  'navigator',
  'location',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'AudioContext',
  'OfflineAudioContext',
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
  // Network and cross-context messaging (R2): pure code computes, it never talks.
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Request',
  'Worker',
  'SharedWorker',
  'importScripts',
  'postMessage',
].map((name) => ({ name, message: R10 }));

const CRYSTAL_CORE_RESTRICTED_GLOBALS = [
  ...PURE_RESTRICTED_GLOBALS,
  ...['Date', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'].map(
    (name) => ({ name, message: R11 }),
  ),
];

const GEOMETRY_RESTRICTED_GLOBALS = [
  ...CRYSTAL_CORE_RESTRICTED_GLOBALS,
  // crypto.subtle (SHA-256) is allowed elsewhere in crystal-core, not here.
  { name: 'crypto', message: VERTEX },
  { name: 'Reflect', message: VERTEX },
];

// ----------------------------------------------------------------- imports

const THREE_MESSAGE = 'Three.js belongs to renderer-three only (AGENTS.md R10).';

const PURE_IMPORT_PATHS = [{ name: 'three', message: THREE_MESSAGE }];

const PURE_IMPORT_PATTERNS = [
  { group: ['three/*'], message: THREE_MESSAGE },
  { group: ['node:*'], message: R10 },
  {
    // Node built-ins without the node: prefix, from Node's own list.
    group: builtinModules.flatMap((name) => [name, `${name}/*`]),
    message: R10,
  },
  {
    group: ['@voicecrystal/renderer-three', '@voicecrystal/vault', '@voicecrystal/extension'],
    message: 'Pure packages must not depend on impure packages (AGENTS.md R10).',
  },
  {
    group: ['**/extension/**', '**/renderer-three/**', '**/vault/**'],
    message: 'Pure packages must not reach into impure code by relative path (AGENTS.md R10).',
  },
];

/** Files outside geometry/ that the vertex path may import (none exist yet). */
export const GEOMETRY_ALLOWED_PARENT_IMPORTS = ['../trig-table.ts'];

/** @param {string} text */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GEOMETRY_IMPORT_PATTERNS = [
  ...PURE_IMPORT_PATTERNS,
  {
    // Any `..` segment, however the path is spelled ('..', './../x', 'a/../../x'),
    // except the exact allowed files. Type-only imports included: shared types
    // come from @voicecrystal/contracts.
    regex: `^(?!(?:${GEOMETRY_ALLOWED_PARENT_IMPORTS.map(escapeRegex).join('|')})$).*(?:^|/)\\.\\.(?:/|$)`,
    message:
      'The vertex path may import only from geometry/ and the listed exact tables (ADR-0010).',
  },
  {
    group: ['@voicecrystal/*', '!@voicecrystal/contracts'],
    message: 'The vertex path may import only types from contracts (ADR-0010).',
  },
];

// -------------------------------------------------------------- properties

/** R17 sinks, shared with eslint.config.js so no block silently drops them. */
export const UNTRUSTED_HTML_PROPERTIES = ['innerHTML', 'outerHTML', 'insertAdjacentHTML'].map(
  (property) => ({ property, message: R17 }),
);

/** Math members whose accuracy ECMAScript leaves to the engine, plus the RNG. */
export const FORBIDDEN_MATH_MEMBERS = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'pow',
  'log',
  'log2',
  'log10',
  'log1p',
  'cbrt',
  'hypot',
];

/**
 * The only Math members allowed in the vertex path: exactly specified by
 * IEEE 754 / ECMAScript (sqrt is correctly rounded), or exact constants.
 */
export const ALLOWED_MATH_MEMBERS = [
  'sqrt',
  'abs',
  'min',
  'max',
  'floor',
  'ceil',
  'trunc',
  'round',
  'sign',
  'fround',
  'imul',
  'clz32',
  'PI',
  'E',
  'SQRT2',
  'SQRT1_2',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
];

const CRYSTAL_CORE_RESTRICTED_PROPERTIES = [
  ...UNTRUSTED_HTML_PROPERTIES,
  { object: 'Math', property: 'random', message: R11 },
  { object: 'crypto', property: 'getRandomValues', message: R11 },
  { object: 'crypto', property: 'randomUUID', message: R11 },
];

const GEOMETRY_RESTRICTED_PROPERTIES = [
  ...UNTRUSTED_HTML_PROPERTIES,
  ...FORBIDDEN_MATH_MEMBERS.map((property) => ({ object: 'Math', property, message: VERTEX })),
];

// ------------------------------------------------------------------ syntax

/** Dynamic import can load anything at runtime, bypassing the import rules. */
const PURE_SYNTAX = [
  { selector: 'ImportExpression', message: `No dynamic import() in pure packages: ${R10}` },
];

/**
 * Lint covers module-level `let`/`var` only. Mutable `const` objects, Maps and
 * static class fields are NOT detected: that part of "no global state" (R11)
 * is a review item (packages/crystal-core/CLAUDE.md).
 */
const NO_MODULE_STATE = [
  {
    selector: "Program > VariableDeclaration[kind!='const']",
    message: `Mutable module state: ${R11}`,
  },
  {
    selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind!='const']",
    message: `Mutable module state: ${R11}`,
  },
];

/** Math and crypto only as static member access, so Math.random / getRandomValues cannot be aliased. */
const NO_ALIASING_RNG = [
  {
    selector: "Identifier[name='Math']:not(MemberExpression[computed=false] > Identifier.object)",
    message: `Use Math only as Math.<member> (no aliasing, computed access or passing it around): ${R11}`,
  },
  {
    selector:
      "Identifier[name='crypto']:not(MemberExpression[computed=false][property.name='subtle'] > Identifier.object)",
    message: `In crystal-core, crypto is allowed only as crypto.subtle (SHA-256): ${R11}`,
  },
];

const CRYSTAL_CORE_SYNTAX = [...PURE_SYNTAX, ...NO_MODULE_STATE, ...NO_ALIASING_RNG];

const allowedMath = ALLOWED_MATH_MEMBERS.join('|');

const GEOMETRY_SYNTAX = [
  ...CRYSTAL_CORE_SYNTAX,
  { selector: "BinaryExpression[operator='**']", message: VERTEX },
  { selector: "AssignmentExpression[operator='**=']", message: VERTEX },
  {
    selector: `MemberExpression[object.name='Math'][computed=false][property.name!=/^(?:${allowedMath})$/]`,
    message: VERTEX,
  },
];

// ------------------------------------------------------------------ blocks

/** @type {import('eslint').Linter.Config[]} */
export const purityConfigs = [
  {
    name: 'voicecrystal/purity/pure-packages',
    files: PURE_SOURCE_GLOBS,
    rules: {
      'no-restricted-globals': ['error', ...PURE_RESTRICTED_GLOBALS],
      'no-restricted-imports': [
        'error',
        { paths: PURE_IMPORT_PATHS, patterns: PURE_IMPORT_PATTERNS },
      ],
      'no-restricted-syntax': ['error', ...PURE_SYNTAX],
    },
  },
  {
    name: 'voicecrystal/purity/crystal-core',
    files: CRYSTAL_CORE_SOURCE_GLOBS,
    rules: {
      'no-restricted-globals': ['error', ...CRYSTAL_CORE_RESTRICTED_GLOBALS],
      'no-restricted-properties': ['error', ...CRYSTAL_CORE_RESTRICTED_PROPERTIES],
      'no-restricted-syntax': ['error', ...CRYSTAL_CORE_SYNTAX],
    },
  },
  {
    name: 'voicecrystal/purity/crystal-core-geometry',
    files: GEOMETRY_SOURCE_GLOBS,
    rules: {
      'no-restricted-globals': ['error', ...GEOMETRY_RESTRICTED_GLOBALS],
      'no-restricted-imports': [
        'error',
        { paths: PURE_IMPORT_PATHS, patterns: GEOMETRY_IMPORT_PATTERNS },
      ],
      'no-restricted-properties': ['error', ...GEOMETRY_RESTRICTED_PROPERTIES],
      'no-restricted-syntax': ['error', ...GEOMETRY_SYNTAX],
    },
  },
];
