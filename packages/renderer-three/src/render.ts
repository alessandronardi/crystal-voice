// renderCrystal (SPEC §10): the WebGL showcase, with the SVG plate as fallback.
//
// Lifecycle: 'webgl' → 'fallback-svg' (context lost, or WebGL unavailable at
// start) → 'disposed'. No restore attempt after a context loss (MVP): the
// plate is the canonical export anyway (ADR-0013).

import { AgXToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import type { CrystalGeometry } from '@voicecrystal/contracts';
import { showPlateFallback } from './fallback.ts';
import { PROFILE_SAMPLE_FRAMES, turntableAngle, type HighlightTarget, type RenderProfile } from './pure/index.ts';
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
  /** Called once when the showcase switches to the SVG plate. */
  onFallback?: (reason: FallbackReason) => void;
  /**
   * I-13b (D-AN): called once with the cost of frames 2–31 of the turntable,
   * measured as M17 (render + 1-pixel readPixels). Not called without motion.
   */
  onFrameCosts?: (costsMs: number[]) => void;
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
      showcase = buildShowcaseScene(geometry, profile, renderer);
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

  return {
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
      if (state === 'disposed') return;
      if (state === 'webgl') releaseGpu(false);
      container.replaceChildren();
      state = 'disposed';
    },
  };
}
