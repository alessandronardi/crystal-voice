import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyExceptions,
  checkCsp,
  checkManifest,
  referencedFiles,
  scanSource,
} from '../scripts/bundle-guard.ts';

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, '../manifest.json'), 'utf8'),
) as Record<string, unknown>;
const allExist = (): boolean => true;
const rules = (findings: { rule: string }[]): string[] => findings.map((f) => f.rule);
const withChanges = (changes: Record<string, unknown>): Record<string, unknown> => ({
  ...manifest,
  ...changes,
});

describe('scanSource: dynamic code (R2)', () => {
  it.each([
    ['eval("1+1")', 'no-eval'],
    ['x=eval (code)', 'no-eval'],
    ['globalThis.eval(code)', 'no-eval'],
    ['window.eval(code)', 'no-eval'],
    ['self["eval"](code)', 'no-eval'],
    ['new Function("return 1")', 'no-function-constructor'],
    // What Vite's minifier turns `new Function(src)` into.
    ['var f=e=>Function(e)', 'no-function-constructor'],
    ['Function(`a`,e)', 'no-function-constructor'],
    ['Reflect.construct(Function,[c])', 'no-function-constructor'],
    ['(()=>{}).constructor("return this")', 'no-function-constructor'],
    ['setTimeout("alert(1)",10)', 'no-string-timer'],
    ['setInterval(`x()`,10)', 'no-string-timer'],
  ])('flags %s', (code, rule) => {
    expect(rules(scanSource('a.js', code))).toContain(rule);
  });

  it.each([
    'retrieval(x)',
    'isFunction(x)',
    'typeof x=="function"',
    'setTimeout(()=>run(),10)',
    'const evaluate=(x)=>x',
    'class A{constructor(x){this.x=x}}',
  ])('does not flag %s', (code) => {
    expect(scanSource('a.js', code)).toEqual([]);
  });
});

describe('scanSource: remote resources (R2)', () => {
  it.each([
    ['a.js', 'import("https://cdn.example/x.js")'],
    ['a.js', 'import x from"//cdn.example/x.js"'],
    ['a.js', 'importScripts("https://cdn.example/x.js")'],
    ['a.js', 'fetch("https://telemetry.example/e")'],
    ['a.js', 'fetch(new Request(`https://telemetry.example/e`))'],
    ['a.js', 'new WebSocket("wss://live.example")'],
    ['a.js', 'navigator.sendBeacon("https://t.example",d)'],
    ['a.js', 'new EventSource("https://s.example")'],
    ['a.js', 'x.open("POST","http://api.example")'],
    ['a.js', 'new Worker("https://cdn.example/w.js")'],
    ['a.html', '<script src="https://cdn.example/x.js"></script>'],
    ['a.html', '<link href="//fonts.example/css">'],
    ['a.html', '<img srcset="https://img.example/a.png 2x">'],
    ['a.html', '<meta http-equiv="refresh" content="0;url=https://x.example">'],
    ['a.css', '@font-face{src:url(https://fonts.example/f.woff2)}'],
    ['a.css', '@import "https://fonts.example/css";'],
    ['a.css', 'a{background:url(//img.example/a.png)}'],
  ])('flags %s: %s', (file, code) => {
    expect(rules(scanSource(file, code))).toContain('no-remote-url');
  });

  it.each([
    ['a.html', '<script type="module" src="/assets/a.js"></script>'],
    ['a.css', '/*! tailwindcss v4 | MIT License | https://tailwindcss.com */a{color:red}'],
    ['a.js', '/*! lib | MIT | https://example.com */import{x}from"./chunk.js"'],
    ['a.js', 'const re=/https?:\\/\\//;'],
    ['a.js', 'createElementNS("http://www.w3.org/2000/svg","svg")'],
    ['a.html', '<!-- https://example.com --><p>ok</p>'],
  ])('accepts %s: %s', (file, code) => {
    expect(scanSource(file, code)).toEqual([]);
  });
});

describe('scanSource: second adversarial review cases', () => {
  it.each([
    ['var x=(0,eval)(e)', 'no-eval'],
    ['const e=globalThis.eval;e(s)', 'no-eval'],
    ['const F=Function;new F(s)', 'no-function-constructor'],
    ['(()=>{}).constructor(s)', 'no-function-constructor'],
    ['fetch(`https://${h}/x`)', 'no-remote-url'],
    ['fetch("https://"+h)', 'no-remote-url'],
    ['new WebSocket("wss:"+"//"+h)', 'no-remote-url'],
    ['const s="//"+h', 'no-remote-url'],
  ])('flags %s', (code, rule) => {
    expect(rules(scanSource('a.js', code))).toContain(rule);
  });

  it.each([
    ['a.html', '<img srcset="a.png 1x, //evil.com/b.png 2x">'],
    ['a.html', '<script type="importmap">{"imports":{"x":"//evil.com/x.js"}}</script>'],
    ['a.css', '@import "//evil.com/x.css";'],
    ['a.svg', '<svg><image href="https://evil.com/a.png"/></svg>'],
    ['a.json', '{"endpoint":"https://evil.com"}'],
  ])('flags %s: %s', (file, code) => {
    expect(rules(scanSource(file, code))).toContain('no-remote-url');
  });

  it('does not let a /* inside a string hide code (L-A)', () => {
    const code = 'const g="src/**/x";fetch("https://evil.com");const k="*/";';
    expect(rules(scanSource('a.js', code))).toContain('no-remote-url');
  });

  it('reports every occurrence, not just the first', () => {
    expect(scanSource('a.js', 'eval(a);eval(b)')).toHaveLength(2);
  });

  it('is deliberately broad: these known false positives fail the build (L-D)', () => {
    expect(rules(scanSource('a.js', 'a.Function(1)'))).toContain('no-function-constructor');
    expect(rules(scanSource('a.js', 'throw Error("bad eval")'))).toContain('no-eval');
  });
});

describe('applyExceptions', () => {
  const finding = { file: 'assets/three.js', rule: 'no-function-constructor', detail: 'x instanceof Function' };

  it('drops only findings matching file, rule and snippet', () => {
    const exception = {
      file: 'assets/three.js',
      rule: 'no-function-constructor',
      snippet: 'instanceof Function',
      reason: 'type check, not a constructor call',
    };
    expect(applyExceptions([finding], [exception])).toEqual([]);
    expect(applyExceptions([finding], [{ ...exception, file: 'other.js' }])).toEqual([finding]);
    expect(applyExceptions([finding], [{ ...exception, rule: 'no-eval' }])).toEqual([finding]);
    expect(applyExceptions([finding], [{ ...exception, snippet: 'new Function' }])).toEqual([finding]);
  });
});

describe('scanSource on real minified output (regression for C1)', () => {
  it('still flags new Function and globalThis.eval after Vite minification', async () => {
    const { build } = await import('vite');
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        lib: {
          entry: join(import.meta.dirname, 'fixtures/dynamic-code.ts'),
          formats: ['es'],
          fileName: () => 'out.js',
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap((o) => ('output' in o ? o.output : []))
      .map((chunk) => ('code' in chunk ? chunk.code : ''))
      .join('\n');
    // The minifier must have rewritten the source: otherwise this test proves nothing.
    expect(code).not.toContain('new Function');
    const findings = rules(scanSource('out.js', code));
    expect(findings).toContain('no-function-constructor');
    expect(findings).toContain('no-eval');
    expect(findings).toContain('no-remote-url');
  }, 60_000);
});

describe('checkCsp', () => {
  it.each([
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self';",
    "script-src 'self'; object-src 'none'; connect-src 'self'",
  ])('accepts %s', (csp) => {
    expect(checkCsp(csp)).toEqual([]);
  });

  it.each([
    "script-src 'self' 'unsafe-eval'; object-src 'self';",
    "script-src 'self' 'unsafe-inline'; object-src 'self';",
    "script-src 'self' https://cdn.example; object-src 'self';",
    "script-src 'self' *; object-src 'self';",
    "script-src 'self' cdn.example.com; object-src 'self';",
    "script-src 'self'; object-src 'self'; connect-src https:",
    "script-src 'self' 'UNSAFE-EVAL'; object-src 'self';",
    "script-src 'self'; object-src 'self'; style-src 'Unsafe-Inline'",
  ])('rejects %s', (csp) => {
    expect(rules(checkCsp(csp))).toContain('csp-source');
  });

  it('requires script-src, object-src and connect-src (ADR-0015)', () => {
    expect(rules(checkCsp("script-src 'self'"))).toEqual(['csp-missing', 'csp-missing']);
    expect(checkCsp("script-src 'self'; object-src 'self'")).toEqual([
      { file: 'manifest.json', rule: 'csp-missing', detail: 'connect-src' },
    ]);
  });

  it.each(["connect-src 'none'", 'connect-src blob:', "connect-src 'self' data:"])(
    'accepts only connect-src self (ADR-0015): rejects %s',
    (directive) => {
      expect(rules(checkCsp(`script-src 'self'; object-src 'self'; ${directive}`))).toContain(
        'csp-source',
      );
    },
  );
});

describe('checkManifest', () => {
  it('accepts the project manifest', () => {
    expect(checkManifest(manifest, allExist)).toEqual([]);
  });

  it('lists the files the manifest references', () => {
    expect(referencedFiles(manifest).sort()).toEqual([
      'background.js',
      'sidepanel.html',
      'youtube-content.js',
    ]);
  });

  it('reports referenced files missing from the bundle', () => {
    expect(checkManifest(manifest, (path) => path !== 'sidepanel.html')).toEqual([
      { file: 'manifest.json', rule: 'missing-referenced-file', detail: 'sidepanel.html' },
    ]);
  });

  it.each(['tabs', 'scripting', 'desktopCapture', '<all_urls>'])(
    'rejects the permission %s without an ADR (R9)',
    (permission) => {
      const widened = withChanges({ permissions: ['storage', permission] });
      expect(rules(checkManifest(widened, allExist))).toEqual(['permission-without-adr']);
    },
  );

  it('rejects permissions that are not a string array', () => {
    expect(rules(checkManifest(withChanges({ permissions: 'tabs' }), allExist))).toEqual([
      'manifest-shape',
    ]);
  });

  it.each([
    'host_permissions',
    'optional_permissions',
    'optional_host_permissions',
    'externally_connectable',
    'web_accessible_resources',
    'sandbox',
    'update_url',
    'declarative_net_request',
    'oauth2',
  ])('rejects the top-level key %s without an ADR (R9)', (key) => {
    expect(rules(checkManifest(withChanges({ [key]: {} }), allExist))).toEqual([
      'manifest-key-without-adr',
    ]);
  });

  it('rejects a sandbox CSP', () => {
    const csp = { ...(manifest['content_security_policy'] as object), sandbox: "sandbox; script-src 'unsafe-eval'" };
    expect(rules(checkManifest(withChanges({ content_security_policy: csp }), allExist))).toEqual([
      'manifest-key-without-adr',
    ]);
  });

  it.each([
    [{ matches: ['<all_urls>'], js: ['youtube-content.js'] }, 'match-without-adr'],
    [{ matches: ['https://*/*'], js: ['youtube-content.js'] }, 'match-without-adr'],
    // SPEC §5's original pattern is superseded by ADR-0021.
    [{ matches: ['https://www.youtube.com/watch*'], js: ['youtube-content.js'] }, 'match-without-adr'],
    [{ matches: ['https://*.youtube.com/*'], js: ['youtube-content.js'] }, 'match-without-adr'],
    [
      { matches: ['https://www.youtube.com/*'], js: ['youtube-content.js'], world: 'MAIN' },
      'manifest-key-without-adr',
    ],
    [
      { matches: ['https://www.youtube.com/*'], js: ['youtube-content.js'], all_frames: true },
      'manifest-key-without-adr',
    ],
  ])('rejects the content script %j (R4, R9)', (entry, rule) => {
    expect(rules(checkManifest(withChanges({ content_scripts: [entry] }), allExist))).toEqual([
      rule,
    ]);
  });

  it.each(['90', '119', 'abc', '120abc', 120])('rejects minimum_chrome_version %j', (version) => {
    expect(
      rules(checkManifest(withChanges({ minimum_chrome_version: version }), allExist)),
    ).toEqual(['minimum-chrome-version']);
  });

  it('rejects a classic (non-module) service worker', () => {
    const background = { service_worker: 'background.js' };
    expect(rules(checkManifest(withChanges({ background }), allExist))).toEqual([
      'manifest-shape',
    ]);
  });

  it('rejects a manifest without CSP or with MV2', () => {
    const { content_security_policy: _csp, ...rest } = manifest;
    expect(rules(checkManifest(rest, allExist))).toEqual(['csp-missing']);
    expect(rules(checkManifest(withChanges({ manifest_version: 2 }), allExist))).toEqual([
      'manifest-version',
    ]);
  });
});
