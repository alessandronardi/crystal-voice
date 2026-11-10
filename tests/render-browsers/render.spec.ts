// I-11 DoD in Chromium with WebGL on SwiftShader (software rasterizer, not a
// real GPU): reference screenshots with tolerance, veiled traits visible,
// 100 mount/unmount cycles without leaks, context loss → SVG plate.
//
// Regenerate the references (only after a deliberate visual change):
//   UPDATE_RENDER_REFERENCE=1 pnpm test:render

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bundleRenderer, ROOT, WEBGL_COUNTERS_SCRIPT } from './harness.ts';

const REFERENCE_DIR = resolve(ROOT, 'tests/fixtures/render');
const UPDATE = process.env['UPDATE_RENDER_REFERENCE'] === '1';
const SIZE = 384;
const ANGLE = 0.6;
/** [H] A pixel differs when a channel moves by more than this (0..255). */
const PIXEL_THRESHOLD = 24;
/** [H] At most this fraction of differing pixels against a reference. */
const MAX_DIFF_RATIO = 0.01;
/** [H] A single veiled trait must change at least this fraction of pixels. */
const MIN_VEIL_RATIO = 0.002;
/**
 * [H] ...or move the whole image by at least this mean |Δ| (0..255): a
 * uniform change such as desaturation (p5) shifts many pixels a little and
 * few beyond PIXEL_THRESHOLD.
 */
const MIN_VEIL_MEAN_ABS = 1;
/** Canvas side of the mount/unmount cycles: leaks do not depend on it, SwiftShader time does. */
const CYCLE_SIZE = 128;

type Seed = [number, number, number, number, number, number];
interface Case {
  name: string;
  seed: Seed;
  confidence: Seed;
  profile: 'vetrina' | 'economy';
}

const FULL: Seed = [1, 1, 1, 1, 1, 1];
const RICH: Seed = [3000, 6000, 9000, 9000, 2000, 8000];
const CASES: Case[] = [
  { name: 'vetrina-mid', seed: [5000, 5000, 5000, 5000, 5000, 5000], confidence: FULL, profile: 'vetrina' },
  { name: 'economy-mid', seed: [5000, 5000, 5000, 5000, 5000, 5000], confidence: FULL, profile: 'economy' },
  { name: 'vetrina-rich', seed: RICH, confidence: FULL, profile: 'vetrina' },
  // At most two veiled traits: with more, ADR-0014 gives INSUFFICIENT_DATA and no crystal is shown.
  { name: 'vetrina-rich-veiled-p1-p4', seed: RICH, confidence: [0.2, 1, 1, 0.2, 1, 1], profile: 'vetrina' },
];

let bundle = '';
const pageErrors: string[] = [];
/** Console errors and warnings fail the test, except these patterns (set per test). */
const consoleProblems: string[] = [];
let allowedConsole: RegExp[] = [];

test.beforeAll(async () => {
  bundle = await bundleRenderer(true);
});

async function openPage(page: Page): Promise<void> {
  pageErrors.length = 0;
  consoleProblems.length = 0;
  allowedConsole = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text()}`);
  });
  await page.addInitScript({ content: WEBGL_COUNTERS_SCRIPT });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><body style="margin:0;background:#000"><div id="stage"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  // Page-side helpers.
  await page.evaluate(() => {
    type Lib = {
      generateCrystalGeometry: (s: number[], c: number[], v: string) => unknown;
      renderCrystal: (g: unknown, c: unknown) => { state: string; canvas: HTMLCanvasElement | null; renderAt(a: number): void; dispose(): void; fallbackReason: string | null };
    };
    type Handle = ReturnType<Lib['renderCrystal']>;
    const g = globalThis as unknown as {
      VoiceCrystalRender: Lib;
      __mount: unknown;
      __handle: Handle | undefined;
      __reasons: string[];
      __snapshot: unknown;
      __compare: unknown;
    };
    const lib = g.VoiceCrystalRender;
    g.__mount = (seed: number[], confidence: number[], profile: string, size: number, reducedMotion = true) => {
      const stage = document.getElementById('stage') as HTMLElement;
      const geometry = lib.generateCrystalGeometry(seed, confidence, 'habit-1');
      const reasons: string[] = [];
      const handle = lib.renderCrystal(geometry, {
        container: stage,
        profile,
        reducedMotion,
        sizePx: size,
        onFallback: (r: string) => {
          reasons.push(r);
        },
      });
      g.__handle = handle;
      g.__reasons = reasons;
      return handle.state;
    };
    g.__snapshot = (angle: number): string => {
      const h = g.__handle;
      if (h === undefined) return '';
      h.renderAt(angle);
      // Same task as the draw: the drawing buffer is still readable without preserveDrawingBuffer.
      return h.canvas?.toDataURL('image/png') ?? '';
    };
    const pixels = async (url: string): Promise<ImageData> => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    };
    g.__compare = async (a: string, b: string, threshold: number) => {
      const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
      if (pa.width !== pb.width || pa.height !== pb.height) return { ratio: 1, meanAbs: 255 };
      let differing = 0;
      let sum = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs((pa.data[i + c] ?? 0) - (pb.data[i + c] ?? 0));
          sum += d;
          if (d > max) max = d;
        }
        if (max > threshold) differing++;
      }
      const n = pa.data.length / 4;
      return { ratio: differing / n, meanAbs: sum / (3 * n) };
    };
  });
}

const mount = (page: Page, c: Pick<Case, 'seed' | 'confidence' | 'profile'>, reducedMotion = true, size = SIZE) =>
  page.evaluate(([s, conf, p, px, rm]) => (globalThis as unknown as { __mount: (...a: unknown[]) => string }).__mount(s, conf, p, px, rm), [c.seed, c.confidence, c.profile, size, reducedMotion] as const);
const snapshot = (page: Page) => page.evaluate((a) => (globalThis as unknown as { __snapshot: (a: number) => string }).__snapshot(a), ANGLE);
const compare = (page: Page, a: string, b: string) =>
  page.evaluate(([x, y, t]) => (globalThis as unknown as { __compare: (...a: unknown[]) => Promise<{ ratio: number; meanAbs: number }> }).__compare(x, y, t), [a, b, PIXEL_THRESHOLD] as const);
const disposeHandle = (page: Page) =>
  page.evaluate(() => {
    (globalThis as unknown as { __handle: { dispose(): void } }).__handle.dispose();
  });

test.describe('renderer-three showcase (SwiftShader)', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
    expect(consoleProblems.filter((p) => !allowedConsole.some((re) => re.test(p)))).toEqual([]);
  });

  for (const c of CASES) {
    test(`reference screenshot: ${c.name}`, async ({ page }) => {
      expect(await mount(page, c)).toBe('webgl');
      const url = await snapshot(page);
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
      const file = resolve(REFERENCE_DIR, `${c.name}.png`);
      if (UPDATE) {
        mkdirSync(REFERENCE_DIR, { recursive: true });
        writeFileSync(file, Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
      }
      const reference = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
      const diff = await compare(page, url, reference);
      console.log(`[render] ${c.name}: differing ${(diff.ratio * 100).toFixed(3)}%, mean |Δ| ${diff.meanAbs.toFixed(3)}`);
      expect(diff.ratio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
      await disposeHandle(page);
    });
  }

  // Necessary, not sufficient: a veil must change the image of a seed that has
  // every element. Recognizability is a human judgement (M19, G2); seeds without
  // the element are covered in Node (pure.test.ts, veilIsVisible).
  test('each veiled trait changes the image (ADR-0014)', async ({ page }) => {
    await mount(page, { seed: RICH, confidence: FULL, profile: 'vetrina' });
    const plain = await snapshot(page);
    await disposeHandle(page);
    for (let i = 0; i < 6; i++) {
      const confidence = [...FULL] as Seed;
      confidence[i] = 0.2;
      await mount(page, { seed: RICH, confidence, profile: 'vetrina' });
      const veiled = await snapshot(page);
      await disposeHandle(page);
      const diff = await compare(page, plain, veiled);
      console.log(`[render] veiled p${i + 1}: differing ${(diff.ratio * 100).toFixed(3)}%, mean |Δ| ${diff.meanAbs.toFixed(3)}`);
      expect(diff.ratio >= MIN_VEIL_RATIO || diff.meanAbs >= MIN_VEIL_MEAN_ABS, `trait p${i + 1}: ${JSON.stringify(diff)}`).toBe(true);
    }
  });

  // Economy and vetrina share the mesh by construction: one bodyGeometry() path,
  // the profile only selects materials (scene.ts). No pixel test claims more.

  test('100 mount/unmount cycles release every WebGL object and context', async ({ page }) => {
    // ~7 min locally on SwiftShader (each new context compiles its shaders in software); margin for CI runners.
    test.setTimeout(1_500_000);
    const client = await page.context().newCDPSession(page);
    const heap = async () => {
      await client.send('HeapProfiler.collectGarbage');
      return (await client.send('Runtime.getHeapUsage')).usedSize;
    };
    type Ctx = { lost: boolean; counts: Record<string, number> };
    const take = () => page.evaluate(() => (globalThis as unknown as { __webglTakeContexts: () => Ctx[] }).__webglTakeContexts());
    const profiles = ['vetrina', 'economy'] as const;
    for (let i = 0; i < 10; i++) {
      await mount(page, { seed: RICH, confidence: FULL, profile: profiles[i % 2] ?? 'vetrina' }, true, CYCLE_SIZE);
      await snapshot(page);
      await disposeHandle(page);
    }
    await take();
    const heapAfterWarmup = await heap();
    const residuals: Record<(typeof profiles)[number], Set<string>> = { vetrina: new Set(), economy: new Set() };
    for (let i = 0; i < 100; i++) {
      const profile = profiles[i % 2] ?? 'vetrina';
      const seed: Seed = [(i * 997) % 10001, (i * 571) % 10001, (i * 389) % 10001, (i * 263) % 10001, (i * 131) % 10001, (i * 67) % 10001];
      expect(await mount(page, { seed, confidence: i % 3 === 0 ? [0.2, 0.2, 0.2, 0.2, 0.2, 0.2] : FULL, profile }, true, CYCLE_SIZE)).toBe('webgl');
      await snapshot(page);
      await disposeHandle(page);
      const contexts = await take();
      // The renderer destroyed its context: nothing is alive in a living context.
      expect(contexts.filter((c) => !c.lost), `living contexts after cycle ${i}`).toEqual([]);
      expect(contexts).toHaveLength(1);
      residuals[profile].add(JSON.stringify(contexts[0]?.counts));
    }
    // What is left in each destroyed context is Three.js 0.186.1 internals that
    // WebGLRenderer.dispose() does not delete and the context loss frees
    // (measured in I-11): 4 default textures of WebGLState and 3 service
    // framebuffers (initGLContext); in vetrina also the transmission render target (1 texture, 2 framebuffers,
    // 3 renderbuffers) and the shadow depth program. The residual must be the
    // same in every cycle: it does not grow with the content of the scene.
    const ECONOMY = { Buffer: 0, Texture: 4, Program: 0, Shader: 0, Framebuffer: 3, Renderbuffer: 0, VertexArray: 0 };
    const VETRINA = { Buffer: 0, Texture: 5, Program: 1, Shader: 0, Framebuffer: 5, Renderbuffer: 3, VertexArray: 0 };
    expect([...residuals.economy].map((s) => JSON.parse(s) as unknown)).toEqual([ECONOMY]);
    expect([...residuals.vetrina].map((s) => JSON.parse(s) as unknown)).toEqual([VETRINA]);
    const heapAfter = await heap();
    const stage = await page.evaluate(() => (document.getElementById('stage') as HTMLElement).childElementCount);
    const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
    const contexts = await page.evaluate(() => (globalThis as unknown as { __webglContexts: { created: number } }).__webglContexts.created);
    console.log(`[render] heap after warmup ${(heapAfterWarmup / 1e6).toFixed(2)} MB, after 100 cycles ${(heapAfter / 1e6).toFixed(2)} MB; contexts created ${contexts}`);
    expect(stage).toBe(0);
    expect(canvases).toBe(0);
    expect(contexts).toBe(110);
    // [H] JS heap growth over 100 cycles. Before the DFG LUT fix it grew ~29 KB per cycle.
    expect(heapAfter - heapAfterWarmup).toBeLessThan(1e6);
  });

  test('webglcontextlost → SVG plate, no exception, dispose idempotent', async ({ page }) => {
    await mount(page, { seed: RICH, confidence: FULL, profile: 'vetrina' }, false);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const h = (globalThis as unknown as { __handle: { canvas: HTMLCanvasElement | null } }).__handle;
      const gl = h.canvas?.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await page.waitForFunction(() => (globalThis as unknown as { __handle: { state: string } }).__handle.state === 'fallback-svg');
    const result = await page.evaluate(() => {
      const g = globalThis as unknown as { __handle: { state: string; fallbackReason: string; dispose(): void }; __reasons: string[] };
      const stage = document.getElementById('stage') as HTMLElement;
      const svg = stage.firstElementChild;
      const out = {
        reason: g.__handle.fallbackReason,
        reasons: [...g.__reasons],
        child: svg?.localName,
        ns: svg?.namespaceURI,
        title: svg?.getElementsByTagName('title').length,
        canvases: document.querySelectorAll('canvas').length,
      };
      g.__handle.dispose();
      g.__handle.dispose();
      return { ...out, state: g.__handle.state, empty: stage.childElementCount === 0 };
    });
    expect(result).toEqual({
      reason: 'context-lost',
      reasons: ['context-lost'],
      child: 'svg',
      ns: 'http://www.w3.org/2000/svg',
      title: 1,
      canvases: 0,
      state: 'disposed',
      empty: true,
    });
  });

  test('no WebGL at all → SVG plate from the start', async ({ page }) => {
    // Three reports the failed context creation on the console: expected here only.
    allowedConsole = [/WebGL context could not be created|Error creating WebGL context/i];
    await page.evaluate(() => {
      const original: HTMLCanvasElement["getContext"] = Reflect.get(HTMLCanvasElement.prototype, "getContext");
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    expect(await mount(page, { seed: RICH, confidence: FULL, profile: 'vetrina' })).toBe('fallback-svg');
    const r = await page.evaluate(() => ({
      reason: (globalThis as unknown as { __handle: { fallbackReason: string } }).__handle.fallbackReason,
      child: document.getElementById('stage')?.firstElementChild?.localName,
    }));
    expect(r).toEqual({ reason: 'webgl-unavailable', child: 'svg' });
    await disposeHandle(page);
  });

  test('turntable turns over time, stops on renderAt, and the angle changes the image', async ({ page }) => {
    const angle = () => page.evaluate(() => (globalThis as unknown as { __handle: { angle: number } }).__handle.angle);
    await mount(page, { seed: RICH, confidence: FULL, profile: 'vetrina' }, false);
    await page.waitForTimeout(1000);
    const a1 = await angle();
    await page.waitForTimeout(1500);
    const a2 = await angle();
    expect(a1).toBeGreaterThan(0);
    expect(a2).toBeGreaterThan(a1);
    const at0 = await page.evaluate(() => (globalThis as unknown as { __snapshot: (a: number) => string }).__snapshot(0));
    const at1 = await page.evaluate(() => (globalThis as unknown as { __snapshot: (a: number) => string }).__snapshot(1));
    await page.waitForTimeout(500);
    expect(await angle()).toBe(1);
    expect((await compare(page, at0, at1)).ratio).toBeGreaterThan(0.01);
    await disposeHandle(page);
  });

  test('reduced motion: a still frame, no turntable', async ({ page }) => {
    await mount(page, { seed: RICH, confidence: FULL, profile: 'economy' }, true);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (globalThis as unknown as { __handle: { angle: number } }).__handle.angle)).toBe(0);
    await disposeHandle(page);
  });

  test('malformed geometry → typed RenderInputError, nothing left on the GPU', async ({ page }) => {
    const r = await page.evaluate(() => {
      const g = globalThis as unknown as {
        VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => { bodies: { faceOfTriangle: Uint16Array; planes: unknown[] }[] }; renderCrystal: (...a: unknown[]) => unknown };
        __webglTakeContexts: () => { lost: boolean }[];
      };
      const geometry = g.VoiceCrystalRender.generateCrystalGeometry([5000, 5000, 5000, 5000, 5000, 5000], [1, 1, 1, 1, 1, 1], 'habit-1');
      const body = geometry.bodies[0];
      if (body) body.faceOfTriangle[0] = body.planes.length;
      let error = 'none';
      try {
        g.VoiceCrystalRender.renderCrystal(geometry, { container: document.getElementById('stage'), profile: 'vetrina', reducedMotion: true, sizePx: 128 });
      } catch (e) {
        error = e instanceof Error ? `${e.name}:${(e as Error & { code?: string }).code ?? ''}` : 'untyped';
      }
      return { error, living: g.__webglTakeContexts().filter((c) => !c.lost).length, canvases: document.querySelectorAll('canvas').length };
    });
    expect(r).toEqual({ error: 'RenderInputError:FACE_INDEX_OUT_OF_RANGE', living: 0, canvases: 0 });
  });
});
