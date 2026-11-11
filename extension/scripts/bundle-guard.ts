// Post-build guard for the MV3 bundle (I-01 DoD; AGENTS.md R2, R4, R9).
// Pure functions so they can be unit-tested on synthetic input; build.ts runs
// them on dist/extension/ and fails the build on any finding.
//
// What it is: a tripwire on the MINIFIED output for the patterns a bundler or
// dependency would realistically introduce. What it is not: a proof that no
// dynamic code or network access exists. The CSP blocks eval at runtime.

export interface Finding {
  file: string;
  rule: string;
  detail: string;
}

// ---------------------------------------------------------------- sources

interface SourceRule {
  rule: string;
  pattern: RegExp;
  appliesTo: (file: string) => boolean;
}

const isJs = (file: string): boolean => /\.(?:js|mjs|cjs)$/.test(file);
const isMarkup = (file: string): boolean => /\.(?:html|svg)$/.test(file);
const isCss = (file: string): boolean => file.endsWith('.css');
const isData = (file: string): boolean => file.endsWith('.json');
const any = (): boolean => true;

/** Absolute URLs that are identifiers, not network endpoints (XML namespaces). */
export const ALLOWED_URL_PREFIXES: readonly string[] = ['http://www.w3.org/'];

/** Extensions the guard scans; anything else in the bundle is reported as unscanned. */
export const SCANNED_EXTENSIONS: readonly string[] = ['.js', '.mjs', '.cjs', '.html', '.svg', '.css', '.json'];

// Deliberately broad: a tripwire with false positives handled by GUARD_EXCEPTIONS
// beats a narrow match with silent false negatives (second adversarial review).
const SOURCE_RULES: readonly SourceRule[] = [
  // The identifier `eval` anywhere: `eval(`, `(0,eval)(`, `globalThis.eval`, `const e=eval`.
  { rule: 'no-eval', pattern: /(?<![\w$])eval(?![\w$])/, appliesTo: isJs },
  // The identifier `Function` anywhere (`new Function`, minified `Function(x)`,
  // `const F=Function`, `Reflect.construct(Function`), and `.constructor(` calls.
  { rule: 'no-function-constructor', pattern: /(?<![\w$])Function(?![\w$])/, appliesTo: isJs },
  { rule: 'no-function-constructor', pattern: /\.constructor\s*\(/, appliesTo: isJs },
  { rule: 'no-string-timer', pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/, appliesTo: isJs },
  // A URL scheme anywhere, including inside templates and concatenations
  // (`https://${h}`, "https:"+"//"+h), and protocol-relative strings.
  { rule: 'no-remote-url', pattern: /(?:https?|wss?|ftp):(?:\/\/|['"`])/i, appliesTo: any },
  { rule: 'no-remote-url', pattern: /['"`]\/\/(?:[\w[]|['"`])/, appliesTo: (f) => isJs(f) || isData(f) },
  { rule: 'no-remote-url', pattern: /(?:^|[\s,='"(])\/\/[\w[]/, appliesTo: (f) => isMarkup(f) || isCss(f) },
];

/** Removes license banners a minifier keeps, so their URLs are not findings. */
function stripComments(file: string, code: string): string {
  if (isCss(file)) return code.replace(/\/\*[\s\S]*?\*\//g, '');
  if (isMarkup(file)) return code.replace(/<!--[\s\S]*?-->/g, '');
  // JS: only `/*!` or `/**` blocks that start a line, so a `/*` inside a
  // string in minified code cannot hide what follows it.
  if (isJs(file)) return code.replace(/(^|\n)[ \t]*\/\*[!*][\s\S]*?\*\//g, '$1');
  return code;
}

function removeAllowedUrls(code: string): string {
  let out = code;
  for (const prefix of ALLOWED_URL_PREFIXES) out = out.split(prefix).join('allowed:');
  return out;
}

/** Scans one bundled file for dynamic code and remote resources (R2). Reports every match. */
export function scanSource(file: string, code: string): Finding[] {
  const cleaned = removeAllowedUrls(stripComments(file, code));
  const findings: Finding[] = [];
  for (const { rule, pattern, appliesTo } of SOURCE_RULES) {
    if (!appliesTo(file)) continue;
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of cleaned.matchAll(global)) {
      const start = Math.max(0, match.index - 30);
      findings.push({ file, rule, detail: cleaned.slice(start, match.index + 50).trim() });
    }
  }
  return findings;
}

/**
 * A reviewed false positive. Each exception must name the file, the rule, the
 * exact snippet it allows and why; it never allows a whole file or rule.
 */
export interface GuardException {
  file: string;
  rule: string;
  /** Substring that must appear in the finding's detail. */
  snippet: string;
  reason: string;
}

/** Reviewed exceptions. Adding one needs a reason in review. */
export const GUARD_EXCEPTIONS: readonly GuardException[] = [
  {
    file: 'background.js',
    rule: 'no-remote-url',
    snippet: 'protocol===`https:`',
    reason:
      'I-02: isYoutubeWatchUrl compares the clicked tab URL protocol with "https:" (SPEC §5, NOT_YOUTUBE_WATCH). A comparison, not a network endpoint.',
  },
];

export function applyExceptions(
  findings: readonly Finding[],
  exceptions: readonly GuardException[],
): Finding[] {
  return findings.filter(
    (f) =>
      !exceptions.some((e) => e.file === f.file && e.rule === f.rule && f.detail.includes(e.snippet)),
  );
}

// --------------------------------------------------------------- manifest

/** Manifest permissions accepted without an ADR (SPEC §5). Adding one requires an ADR (R9). */
export const ALLOWED_PERMISSIONS: readonly string[] = [
  'tabCapture',
  'offscreen',
  'sidePanel',
  'activeTab',
  'storage',
];

/** The only content-script match pattern approved by SPEC §5. */
export const ALLOWED_CONTENT_SCRIPT_MATCHES: readonly string[] = ['https://www.youtube.com/watch*'];

export const MINIMUM_CHROME_VERSION = 120;

/**
 * Allowlist of manifest keys (SPEC §5). Anything else (host_permissions,
 * web_accessible_resources, sandbox, externally_connectable, update_url,
 * declarative_net_request, ...) fails the build until an ADR adds it here.
 */
const ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  '': [
    'manifest_version',
    'name',
    'version',
    'description',
    'minimum_chrome_version',
    'permissions',
    'action',
    'background',
    'side_panel',
    'content_scripts',
    'content_security_policy',
    'icons',
  ],
  action: ['default_title', 'default_icon'],
  background: ['service_worker', 'type'],
  side_panel: ['default_path'],
  content_scripts: ['matches', 'js', 'css', 'run_at'],
  content_security_policy: ['extension_pages'],
};

const ALLOWED_CSP_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'object-src': ["'self'", "'none'"],
  // ADR-0015: network only to the extension's own origin.
  'connect-src': ["'self'"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Checks the CSP for remote sources and unsafe keywords. */
export function checkCsp(csp: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const directives = csp
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  for (const directive of directives) {
    const [rawName = '', ...sources] = directive.split(/\s+/);
    const name = rawName.toLowerCase();
    seen.add(name);
    const allowed = ALLOWED_CSP_SOURCES[name];
    for (const raw of sources) {
      // CSP keywords are case-insensitive.
      const source = raw.toLowerCase();
      const remoteOrWildcard = source.includes(':') || source.includes('*') || source.includes('.');
      const unsafe = /^'unsafe-(?:eval|inline|hashes)'$/.test(source);
      if (remoteOrWildcard || unsafe || (allowed !== undefined && !allowed.includes(source))) {
        findings.push({ file: 'manifest.json', rule: 'csp-source', detail: `${name} ${raw}` });
      }
    }
  }
  for (const required of Object.keys(ALLOWED_CSP_SOURCES)) {
    if (!seen.has(required)) {
      findings.push({ file: 'manifest.json', rule: 'csp-missing', detail: required });
    }
  }
  return findings;
}

function checkKeys(scope: string, value: Record<string, unknown>, findings: Finding[]): void {
  const allowed = ALLOWED_KEYS[scope] ?? [];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      const path = scope === '' ? key : `${scope}.${key}`;
      findings.push({ file: 'manifest.json', rule: 'manifest-key-without-adr', detail: path });
    }
  }
}

/** Lists every bundle-relative file the manifest points to. */
export function referencedFiles(manifest: Record<string, unknown>): string[] {
  const files: string[] = [];
  const pick = (record: unknown, key: string): void => {
    if (isRecord(record) && typeof record[key] === 'string') files.push(record[key]);
  };
  pick(manifest['background'], 'service_worker');
  pick(manifest['side_panel'], 'default_path');
  const contentScripts = manifest['content_scripts'];
  if (Array.isArray(contentScripts)) {
    for (const entry of contentScripts) {
      if (!isRecord(entry)) continue;
      for (const key of ['js', 'css']) {
        const list = entry[key];
        if (isStringArray(list)) files.push(...list);
      }
    }
  }
  for (const icons of [manifest['icons'], isRecord(manifest['action']) ? manifest['action']['default_icon'] : undefined]) {
    if (typeof icons === 'string') files.push(icons);
    if (isRecord(icons)) files.push(...Object.values(icons).filter((v) => typeof v === 'string'));
  }
  return files;
}

/** Validates structure (R9), permissions (R9), content scripts (R4, R9), CSP (R2) and files. */
export function checkManifest(
  manifest: unknown,
  fileExists: (relativePath: string) => boolean,
): Finding[] {
  const file = 'manifest.json';
  if (!isRecord(manifest)) return [{ file, rule: 'manifest-shape', detail: 'not an object' }];
  const findings: Finding[] = [];
  const add = (rule: string, detail: string): void => {
    findings.push({ file, rule, detail });
  };

  checkKeys('', manifest, findings);
  for (const scope of ['action', 'background', 'side_panel', 'content_security_policy']) {
    const value = manifest[scope];
    if (value !== undefined && !isRecord(value)) add('manifest-shape', scope);
    if (isRecord(value)) checkKeys(scope, value, findings);
  }

  if (manifest['manifest_version'] !== 3) add('manifest-version', String(manifest['manifest_version']));

  const minimum = manifest['minimum_chrome_version'];
  if (typeof minimum !== 'string' || !/^\d+$/.test(minimum) || Number(minimum) < MINIMUM_CHROME_VERSION) {
    add('minimum-chrome-version', String(minimum));
  }

  const background = manifest['background'];
  if (!isRecord(background) || background['type'] !== 'module') add('manifest-shape', 'background.type');

  const permissions = manifest['permissions'];
  if (!isStringArray(permissions)) {
    add('manifest-shape', 'permissions');
  } else {
    for (const permission of permissions) {
      if (!ALLOWED_PERMISSIONS.includes(permission)) add('permission-without-adr', permission);
    }
  }

  const contentScripts = manifest['content_scripts'];
  if (contentScripts !== undefined) {
    if (!Array.isArray(contentScripts)) {
      add('manifest-shape', 'content_scripts');
    } else {
      for (const entry of contentScripts) {
        if (!isRecord(entry)) {
          add('manifest-shape', 'content_scripts[]');
          continue;
        }
        checkKeys('content_scripts', entry, findings);
        const matches = entry['matches'];
        if (!isStringArray(matches)) {
          add('manifest-shape', 'content_scripts[].matches');
        } else {
          for (const match of matches) {
            if (!ALLOWED_CONTENT_SCRIPT_MATCHES.includes(match)) add('match-without-adr', match);
          }
        }
      }
    }
  }

  const csp = manifest['content_security_policy'];
  const pagesCsp = isRecord(csp) ? csp['extension_pages'] : undefined;
  if (typeof pagesCsp === 'string') {
    findings.push(...checkCsp(pagesCsp));
  } else {
    add('csp-missing', 'content_security_policy.extension_pages');
  }

  for (const referenced of referencedFiles(manifest)) {
    if (!fileExists(referenced)) add('missing-referenced-file', referenced);
  }
  return findings;
}
