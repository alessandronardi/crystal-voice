// `pnpm bench:render` (I-11): first-frame time, frame time p50/p90/p95 and a
// 100-cycle mount/unmount run of the renderer-three showcase, in Chromium.
//
//   pnpm bench:render                 headed, real GPU: the reference measure
//   pnpm bench:render --swiftshader   headless SwiftShader (no GPU): NOT a reference
//   pnpm bench:render --pause 15      seconds to wait before and after the 100 cycles,
//                                     to read "GPU memory" in Chrome's Task Manager
//   pnpm bench:render --show 60       at the end, 60 s of the same crystal plain (left) and
//                                     with p1 and p4 veiled (right), turning: M19
//
// Output: tests/benchmarks/out/render-<timestamp>.json and render-latest.json
// (not versioned). The GPU string comes from WEBGL_debug_renderer_info.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { bundleRenderer, ROOT, SWIFTSHADER_ARGS } from '../render-browsers/harness.ts';

const argv = process.argv.slice(2);
const swiftshader = argv.includes('--swiftshader');
const pauseIndex = argv.indexOf('--pause');
const pauseS = pauseIndex >= 0 ? Number(argv[pauseIndex + 1] ?? '0') : 0;
const showIndex = argv.indexOf('--show');
const showS = showIndex >= 0 ? Number(argv[showIndex + 1] ?? '0') : 0;
const SIZE = 512;
const FRAMES = 300;
const FIRST_FRAME_RUNS = 10;
const SEED = [3000, 6000, 9000, 9000, 2000, 8000];

const isSoftware = (gpu: string): boolean => /swiftshader|llvmpipe|software|basic render/i.test(gpu);

const quantiles = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? Number.NaN;
  return { n: s.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: s[s.length - 1] ?? Number.NaN };
};

async function main(): Promise<void> {
  const bundle = await bundleRenderer(true);
  const browser = await chromium.launch({ channel: 'chromium', headless: swiftshader, args: swiftshader ? SWIFTSHADER_ARGS : [] });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><body style="margin:0;background:#000"><div id="stage"></div></body>');
  await page.addScriptTag({ content: bundle });

  const environment = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const out = {
      userAgent: navigator.userAgent,
      devicePixelRatio: globalThis.devicePixelRatio,
      gpuVendor: info && gl ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) : 'n/d',
      gpuRenderer: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'n/d',
    };
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  });
  // Reference only on a real GPU: headed Chrome on a machine without one also falls back to SwiftShader.
  const reference = !swiftshader && !isSoftware(environment.gpuRenderer);
  console.log(`GPU: ${environment.gpuRenderer} (${reference ? 'GPU reale, di riferimento' : 'rasterizzatore software, NON di riferimento'})`);

  const results: Record<string, unknown> = {};
  for (const profile of ['vetrina', 'economy'] as const) {
    // First frame: renderCrystal → first frame on screen, GPU synced by a 1-pixel readPixels.
    const firstFrame: number[] = [];
    for (let i = 0; i < FIRST_FRAME_RUNS; i++) {
      firstFrame.push(
        await page.evaluate(
          ([p, size, seed]) => {
            const lib = (globalThis as unknown as { VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => unknown; renderCrystal: (...a: unknown[]) => { canvas: HTMLCanvasElement | null; dispose(): void } } }).VoiceCrystalRender;
            const stage = document.getElementById('stage');
            const geometry = lib.generateCrystalGeometry(seed, [1, 1, 1, 1, 1, 1], 'habit-1');
            const t0 = performance.now();
            const h = lib.renderCrystal(geometry, { container: stage, profile: p, reducedMotion: true, sizePx: size });
            h.canvas?.getContext('webgl2')?.readPixels(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4));
            const dt = performance.now() - t0;
            h.dispose();
            return dt;
          },
          [profile, SIZE, SEED] as const,
        ),
      );
    }
    // Frame cost: one draw + GPU sync, FRAMES times at increasing angles.
    const frameCost = await page.evaluate(
      ([p, size, seed, frames]) => {
        const lib = (globalThis as unknown as { VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => unknown; renderCrystal: (...a: unknown[]) => { canvas: HTMLCanvasElement | null; renderAt(a: number): void; dispose(): void } } }).VoiceCrystalRender;
        const stage = document.getElementById('stage');
        const h = lib.renderCrystal(lib.generateCrystalGeometry(seed, [1, 1, 1, 1, 1, 1], 'habit-1'), { container: stage, profile: p, reducedMotion: true, sizePx: size });
        const gl = h.canvas?.getContext('webgl2');
        const px = new Uint8Array(4);
        const out: number[] = [];
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          h.renderAt((i / frames) * 2 * Math.PI);
          gl?.readPixels(0, 0, 1, 1, 0x1908, 0x1401, px);
          out.push(performance.now() - t0);
        }
        h.dispose();
        return out;
      },
      [profile, SIZE, SEED, FRAMES] as const,
    );
    // Frame interval with the turntable running (includes vsync).
    const intervals = await page.evaluate(
      async ([p, size, seed, frames]) => {
        const lib = (globalThis as unknown as { VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => unknown; renderCrystal: (...a: unknown[]) => { dispose(): void } } }).VoiceCrystalRender;
        const stage = document.getElementById('stage');
        const h = lib.renderCrystal(lib.generateCrystalGeometry(seed, [1, 1, 1, 1, 1, 1], 'habit-1'), { container: stage, profile: p, reducedMotion: false, sizePx: size });
        const stamps: number[] = [];
        await new Promise<void>((done) => {
          const tick = (t: number) => {
            stamps.push(t);
            if (stamps.length > frames) done();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        h.dispose();
        return stamps.slice(1).map((t, i) => t - (stamps[i] ?? t));
      },
      [profile, SIZE, SEED, FRAMES] as const,
    );
    // First frame: n = 10, so only the median and the raw values are meaningful.
    const sortedFirst = [...firstFrame].sort((a, b) => a - b);
    results[profile] = { firstFrameMedianMs: sortedFirst[Math.floor((sortedFirst.length - 1) / 2)], firstFrameRawMs: firstFrame, frameCostMs: quantiles(frameCost), frameIntervalMs: quantiles(intervals.slice(30)) };
    const r = results[profile] as { firstFrameMedianMs: number; frameCostMs: ReturnType<typeof quantiles>; frameIntervalMs: ReturnType<typeof quantiles> };
    console.log(
      `${profile}: primo frame mediana ${r.firstFrameMedianMs.toFixed(1)} ms (primo assoluto ${(firstFrame[0] ?? 0).toFixed(1)}) · costo frame p50/p90/p95 ${r.frameCostMs.p50.toFixed(2)}/${r.frameCostMs.p90.toFixed(2)}/${r.frameCostMs.p95.toFixed(2)} ms · intervallo p50/p90/p95 ${r.frameIntervalMs.p50.toFixed(2)}/${r.frameIntervalMs.p90.toFixed(2)}/${r.frameIntervalMs.p95.toFixed(2)} ms`,
    );
  }

  // 100 cycles, for GPU memory in Chrome's Task Manager (Shift+Esc → column "GPU memory").
  if (pauseS > 0) {
    console.log(`Leggi ora la memoria GPU (prima dei cicli). Attesa ${pauseS} s…`);
    await page.waitForTimeout(pauseS * 1000);
  }
  const cyclesMs = await page.evaluate(
    ([size, seed]) => {
      const lib = (globalThis as unknown as { VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => unknown; renderCrystal: (...a: unknown[]) => { renderAt(a: number): void; dispose(): void } } }).VoiceCrystalRender;
      const stage = document.getElementById('stage');
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        const h = lib.renderCrystal(lib.generateCrystalGeometry(seed, [1, 1, 1, 1, 1, 1], 'habit-1'), { container: stage, profile: i % 2 === 0 ? 'vetrina' : 'economy', reducedMotion: true, sizePx: size });
        h.renderAt(i * 0.1);
        h.dispose();
      }
      return performance.now() - t0;
    },
    [SIZE, SEED] as const,
  );
  console.log(`100 cicli monta/smonta: ${(cyclesMs / 1000).toFixed(1)} s`);
  if (pauseS > 0) {
    console.log(`Leggi ora la memoria GPU (dopo i cicli). Attesa ${pauseS} s…`);
    await page.waitForTimeout(pauseS * 1000);
  }
  if (showS > 0) {
    await page.setViewportSize({ width: 2 * SIZE + 48, height: SIZE + 32 });
    await page.evaluate(
      ([size, seed]) => {
        const lib = (globalThis as unknown as { VoiceCrystalRender: { generateCrystalGeometry: (...a: unknown[]) => unknown; renderCrystal: (...a: unknown[]) => unknown } }).VoiceCrystalRender;
        const stage = document.getElementById('stage') as HTMLElement;
        stage.style.cssText = 'display:flex;gap:16px;padding:16px';
        const veiled = [0.2, 1, 1, 0.2, 1, 1];
        for (const confidence of [[1, 1, 1, 1, 1, 1], veiled]) {
          const box = document.createElement('div');
          stage.append(box);
          lib.renderCrystal(lib.generateCrystalGeometry(seed, confidence, 'habit-1'), { container: box, profile: 'vetrina', reducedMotion: false, sizePx: size });
        }
      },
      [SIZE, SEED] as const,
    );
    console.log(`Vetrina: sinistra senza veli, destra p1 e p4 velati. Attesa ${showS} s…`);
    await page.waitForTimeout(showS * 1000);
  }
  await browser.close();

  const now = new Date();
  const report = { kind: 'render-bench', date: now.toISOString(), reference, sizePx: SIZE, frames: FRAMES, seed: SEED, environment, results, cycles100Ms: cyclesMs };
  const outDir = join(ROOT, 'tests/benchmarks/out');
  mkdirSync(outDir, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(outDir, `render-${now.toISOString().replace(/[:.]/g, '-')}.json`), text);
  writeFileSync(join(outDir, 'render-latest.json'), text);
}

await main();
