// renderCrystal (SPEC §10): the WebGL showcase, with the SVG plate as fallback.
//
// Lifecycle: 'webgl' → 'fallback-svg' (context lost, or WebGL unavailable at
// start) → 'disposed'. No restore attempt after a context loss (MVP): the
// plate is the canonical export anyway (ADR-0013).

import { AgXToneMapping, OrthographicCamera, PCFShadowMap, SRGBColorSpace, WebGLRenderer, type PerspectiveCamera } from 'three';
import type { CrystalGeometry } from '@voicecrystal/contracts';
import { showPlateFallback } from './fallback.ts';
import { FRAMING_RADIUS, PROFILE_SAMPLE_FRAMES, turntableAngle, type HighlightTarget, type RenderProfile } from './pure/index.ts';
import { buildShowcaseScene, type ShowcaseScene } from './scene.ts';

export type RenderState = 'webgl' | 'fallback-svg' | 'disposed';
export type FallbackReason = 'webgl-unavailable' | 'context-lost';

export interface RenderConfig {
  /** Element that receives the canvas (or the SVG plate on fallback). Its children are replaced. */
  container: HTMLElement;
  profile: RenderProfile;
  /** prefers-reduced-motion: no turntable, one still frame. */
  reducedMotion: boolean;
  /** Square canvas side in CSS pixels. */
  sizePx: number;
  /** Keeps the shared framing scale (1) instead of fitting each crystal to the frame, for side-by-side comparison (I-15). */
  fixedScale?: boolean;
  /** Called once when the showcase switches to the SVG plate. */
  onFallback?: (reason: FallbackReason) => void;
  /**
   * I-13b (D-AN): called once with the cost of frames 2–31 of the turntable,
   * measured as M17 (render + 1-pixel readPixels). Not called without motion.
   */
  onFrameCosts?: (costsMs: number[]) => void;
}

export type SnapshotHook = (sizePx: number) => HTMLCanvasElement | null;

const SNAPSHOT_HOOKS = new WeakMap<RenderHandle, SnapshotHook>();

/** Package-internal access for `exportCrystalPng` / `renderCrystalThumbnail` without leaking Three.js types. */
export function getSnapshotHook(handle: RenderHandle): SnapshotHook | undefined {
  return SNAPSHOT_HOOKS.get(handle);
}

export interface RenderHandle {
  readonly state: RenderState;
  readonly profile: RenderProfile;
  readonly fallbackReason: FallbackReason | null;
  /** The canvas while in 'webgl', otherwise null. */
  readonly canvas: HTMLCanvasElement | null;
  /** Turntable angle of the last drawn frame, radians. */
  readonly angle: number;
  /** I-13b: the trait lit by the legend, or null (ADR-0028). */
  readonly highlighted: HighlightTarget | null;
  /** Lights up one trait, or none; redraws at once when the turntable is still. */
  highlight(target: HighlightTarget | null): void;
  /** Stops the turntable and renders one frame at a fixed angle (tests, benchmarks, stills). */
  renderAt(angleRad: number): void;
  /** Idempotent. Releases every GPU resource and the WebGL context. */
  dispose(): void;
}

/** [H] Device pixel ratio cap: vetrina 2, economy 1. */
const MAX_PIXEL_RATIO: Record<RenderProfile, number> = { vetrina: 2, economy: 1 };

export function renderCrystal(geometry: CrystalGeometry, config: RenderConfig): RenderHandle {
  const { container, profile, sizePx } = config;
  let state: RenderState = 'webgl';
  let fallbackReason: FallbackReason | null = null;
  let renderer: WebGLRenderer | null = null;
  let showcase: ShowcaseScene | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let frame = 0;
  let spinning = !config.reducedMotion;
  let start = -1;
  let angle = 0;
  let highlighted: HighlightTarget | null = null;
  let drawn = 0;
  const costs: number[] = [];
  const pixel = new Uint8Array(4);

  const draw = (a: number): void => {
    if (renderer === null || showcase === null) return;
    showcase.turntable.rotation.y = a;
    renderer.render(showcase.scene, showcase.camera);
    angle = a;
  };

  const loop = (now: number): void => {
    frame = 0;
    if (!spinning || state !== 'webgl') return;
    if (start < 0) start = now;
    const measuring = config.onFrameCosts !== undefined && drawn >= 1 && costs.length < PROFILE_SAMPLE_FRAMES;
    const t0 = measuring ? performance.now() : 0;
    draw(turntableAngle(now - start));
    drawn++;
    if (measuring && renderer !== null) {
      // GPU sync as bench:render (M17): the cost includes the GPU work of the frame.
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      costs.push(performance.now() - t0);
      if (costs.length === PROFILE_SAMPLE_FRAMES) config.onFrameCosts?.([...costs]);
    }
    // onFrameCosts may have disposed the showcase (the compiler cannot see the callback change state).
    if ((state as RenderState) !== 'webgl') return;
    frame = requestAnimationFrame(loop);
  };

  const releaseGpu = (contextAlreadyLost: boolean): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    canvas?.removeEventListener('webglcontextlost', onContextLost);
    showcase?.dispose();
    showcase = null;
    if (renderer !== null) {
      renderer.renderLists.dispose();
      renderer.dispose();
      if (!contextAlreadyLost) renderer.forceContextLoss();
    }
    renderer = null;
    canvas?.remove();
    canvas = null;
  };

  const fallBack = (reason: FallbackReason, contextAlreadyLost: boolean): void => {
    if (state !== 'webgl') return;
    releaseGpu(contextAlreadyLost);
    state = 'fallback-svg';
    fallbackReason = reason;
    config.onFallback?.(reason);
    // A plate error is a defect of the geometry, not of the GPU: the state is
    // already consistent (no GPU resource, empty container), so let it surface.
    container.replaceChildren();
    showPlateFallback(container, geometry, sizePx);
  };

  function onContextLost(): void {
    fallBack('context-lost', true);
  }

  // 1. The context: only a failure here means "no WebGL" (no context, blocklisted GPU).
  try {
    canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: profile === 'economy' ? 'low-power' : 'default' });
  } catch {
    renderer = null;
  }
  if (renderer === null || canvas === null) {
    fallBack('webgl-unavailable', true);
  } else if (renderer.getContext().isContextLost()) {
    // Lost before we listened (GPU process crash): 'webglcontextlost' will not come.
    fallBack('webgl-unavailable', true);
  } else {
    canvas.addEventListener('webglcontextlost', onContextLost);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO[profile]));
    renderer.setSize(sizePx, sizePx);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = profile === 'vetrina';
    renderer.shadowMap.type = PCFShadowMap;
    // 2. The scene: a malformed geometry throws a typed RenderInputError to the
    // caller (it is not a GPU problem), after releasing what was created.
    try {
      showcase = buildShowcaseScene(geometry, profile, renderer, config.fixedScale ?? false);
    } catch (error) {
      releaseGpu(false);
      state = 'disposed';
      throw error;
    }
    container.replaceChildren(canvas);
    draw(0);
    drawn = 1;
    if (spinning) frame = requestAnimationFrame(loop);
  }

  const handle: RenderHandle = {
    get state() {
      return state;
    },
    profile,
    get fallbackReason() {
      return fallbackReason;
    },
    get canvas() {
      return canvas;
    },
    get angle() {
      return angle;
    },
    get highlighted() {
      return highlighted;
    },
    highlight(target) {
      // Only the WebGL showcase lights a trait; the SVG plate does not (ADR-0028 point 6).
      highlighted = state === 'webgl' ? target : null;
      showcase?.setHighlight(highlighted);
      container.dataset['highlight'] = highlighted ?? '';
      if (!spinning && state === 'webgl') draw(angle);
    },
    renderAt(angleRad: number) {
      spinning = false;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      if (state === 'webgl') draw(angleRad);
    },
    dispose() {
      SNAPSHOT_HOOKS.delete(handle);
      if (state === 'disposed') return;
      if (state === 'webgl') releaseGpu(false);
      container.replaceChildren();
      state = 'disposed';
    },
  };

  SNAPSHOT_HOOKS.set(handle, (exportSizePx: number) => {
    if (state !== 'webgl' || renderer === null || showcase === null || canvas === null) return null;
    const prevPixelRatio = renderer.getPixelRatio();
    const savedAngle = angle;
    const savedHighlight = highlighted;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = exportSizePx;
    outCanvas.height = exportSizePx;
    const ctx = outCanvas.getContext('2d');
    if (ctx === null) return null;

    const ortho = new OrthographicCamera(
      -FRAMING_RADIUS,
      FRAMING_RADIUS,
      FRAMING_RADIUS,
      -FRAMING_RADIUS,
      showcase.camera.near,
      showcase.camera.far,
    );
    ortho.position.copy(showcase.camera.position);
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();

    // Borrow showcase.camera.id so Three.js WebGLRenderState reuses and resizes the single
    // transmissionRenderTarget rather than allocating a second target keyed to a new camera ID.
    const cam = showcase.camera as PerspectiveCamera & { isOrthographicCamera?: boolean };
    try {
      if (savedHighlight !== null) showcase.setHighlight(null);
      cam.projectionMatrix.copy(ortho.projectionMatrix);
      cam.projectionMatrixInverse.copy(ortho.projectionMatrixInverse);
      cam.isOrthographicCamera = true;
      renderer.setPixelRatio(1);
      renderer.setSize(exportSizePx, exportSizePx, false);
      renderer.render(showcase.scene, showcase.camera);
      // Copy synchronously before returning to the event loop (preserveDrawingBuffer is false).
      ctx.drawImage(canvas, 0, 0, exportSizePx, exportSizePx);
      return outCanvas;
    } finally {
      delete cam.isOrthographicCamera;
      showcase.camera.updateProjectionMatrix();
      renderer.setPixelRatio(prevPixelRatio);
      renderer.setSize(sizePx, sizePx, false);
      if (savedHighlight !== null) showcase.setHighlight(savedHighlight);
      draw(savedAngle);
    }
  });

  return handle;
}
