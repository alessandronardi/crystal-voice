// I-01 E2E: the bundle loads as an extension and the service worker answers
// a diagnostic ping. Requires `pnpm build` first.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist/extension');
// VC_E2E_HEADLESS=1 runs headless; see tests/e2e/README.md for what was verified.
const HEADLESS = process.env['VC_E2E_HEADLESS'] === '1';

let context: BrowserContext;
let userDataDir: string;

test.beforeAll(async () => {
  if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error('dist/extension/manifest.json not found: run `pnpm build` first.');
  }
  userDataDir = mkdtempSync(join(tmpdir(), 'voicecrystal-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: HEADLESS,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
});

test.afterAll(async () => {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('the extension loads and its service worker answers a ping', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  expect(worker.url()).toBe(`chrome-extension://${extensionId}/background.js`);

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator('h1')).toHaveText('VoiceCrystal');

  const reply: unknown = await page.evaluate(() =>
    chrome.runtime.sendMessage({ v: 1, type: 'PING', nonce: 'e2e-nonce' }),
  );
  expect(reply).toEqual({ v: 1, type: 'PONG', nonce: 'e2e-nonce', extensionVersion: '0.3.0' });

  // A malformed message gets no answer.
  const ignored: unknown = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'PING' }).catch(() => 'no-response'),
  );
  expect(ignored === undefined || ignored === 'no-response').toBe(true);

  expect(errors).toEqual([]);
});

test('every extension page loads without errors', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  for (const path of ['sidepanel.html', 'collection.html', 'permission.html', 'offscreen.html']) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const response = await page.goto(`chrome-extension://${extensionId}/${path}`);
    expect(response?.ok(), path).toBe(true);
    await page.waitForLoadState('load');
    expect(errors, path).toEqual([]);
    await page.close();
  }
});

// ADR-0015: connect-src 'self'. The CSP rejects the request before any
// connection, so this test does not depend on the network being reachable.
test('the CSP blocks network requests from pages and the service worker', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const fromPage = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) => {
      document.addEventListener('securitypolicyviolation', (e) => {
        resolve(e.effectiveDirective);
      });
    });
    const outcome = await fetch('https://example.com/').then(
      () => 'allowed',
      () => 'rejected',
    );
    return { outcome, directive: await violation };
  });
  expect(fromPage).toEqual({ outcome: 'rejected', directive: 'connect-src' });

  const fromWorker = await worker.evaluate(() =>
    fetch('https://example.com/').then(
      () => 'allowed',
      () => 'rejected',
    ),
  );
  expect(fromWorker).toBe('rejected');

  // Own-origin requests stay allowed.
  const own = await page.evaluate(() => fetch('/manifest.json').then((r) => r.ok));
  expect(own).toBe(true);
  await page.close();
});
