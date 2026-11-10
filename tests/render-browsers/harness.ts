// Shared by render.spec.ts and tests/benchmarks/render.ts: bundles the
// showcase into one IIFE (global `VoiceCrystalRender`) and instruments WebGL
// object creation, so leaks are counted exactly, per object type.

import { resolve } from 'node:path';
import { build } from 'vite';

export const ROOT = resolve(import.meta.dirname, '../..');

export async function bundleRenderer(minify = true): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: ROOT,
    build: {
      write: false,
      minify,
      lib: { entry: resolve(ROOT, 'tests/render-browsers/render-entry.ts'), formats: ['iife'], name: 'VoiceCrystalRender' },
    },
  });
  let code = '';
  for (const out of Array.isArray(result) ? result : [result]) {
    if ('output' in out) for (const chunk of out.output) if (chunk.type === 'chunk') code += chunk.code;
  }
  return code;
}

/**
 * Init script (runs before the bundle): counts live WebGL objects per context,
 * i.e. create* minus delete* calls. Objects never deleted explicitly are
 * freed by the browser when their context is destroyed (forceContextLoss), so
 * the tests require: zero live objects in any context that is still alive,
 * and a constant residual per destroyed context (no growth with content).
 */
export const WEBGL_COUNTERS_SCRIPT = `(() => {
  const kinds = ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray'];
  const zero = () => Object.fromEntries(kinds.map((k) => [k, 0]));
  const live = zero();
  const perContext = new Map();
  const contexts = { created: 0 };
  const proto = WebGL2RenderingContext.prototype;
  const of = (ctx) => { let c = perContext.get(ctx); if (!c) { c = zero(); perContext.set(ctx, c); } return c; };
  for (const kind of kinds) {
    const create = proto['create' + kind];
    const del = proto['delete' + kind];
    proto['create' + kind] = function (...args) { const o = create.apply(this, args); if (o) { live[kind]++; of(this)[kind]++; } return o; };
    proto['delete' + kind] = function (o) { if (o) { live[kind]--; of(this)[kind]--; } return del.call(this, o); };
  }
  /** Snapshot and forget destroyed contexts: [{ lost, counts }]. */
  globalThis.__webglTakeContexts = () => {
    const out = [];
    for (const [ctx, counts] of perContext) {
      const lost = ctx.isContextLost();
      out.push({ lost, counts: { ...counts } });
      if (lost) perContext.delete(ctx);
    }
    return out;
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && (type === 'webgl2' || type === 'webgl')) {
      if (!this.__vcCounted) { this.__vcCounted = true; contexts.created++; }
    }
    return ctx;
  };
  globalThis.__webglLive = live;
  globalThis.__webglContexts = contexts;
})();`;

/** Chromium flags: WebGL on the SwiftShader software rasterizer, the same on every machine and in CI. */
export const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
