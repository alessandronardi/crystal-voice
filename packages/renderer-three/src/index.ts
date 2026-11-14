// @voicecrystal/renderer-three — museum showcase with Three.js 0.186.1 (SPEC §10, ADR-0012).
// Not a pure package: it owns WebGL resources. Its pure core is in ./pure.
export * from './pure/index.ts';
export { renderCrystal, type FallbackReason, type RenderConfig, type RenderHandle, type RenderState } from './render.ts';
export { buildShowcaseScene, type ShowcaseScene } from './scene.ts';
export { showPlateFallback } from './fallback.ts';
export { probeGpu, type GpuProbe } from './gpu-probe.ts';
