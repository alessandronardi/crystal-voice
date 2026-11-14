// What chooseProfile needs to know about the GPU (I-13b). One throwaway
// context per call, released at once. The renderer name stays in memory only
// (the side panel keeps the probe while it is open, to choose the profile of
// each crystal); it is never stored, logged, shown or sent (decision of the
// product owner, 2026-11-10).

export interface GpuProbe {
  /** A WebGL 2 context could be created at all. */
  webgl: boolean;
  /** True when only a context without failIfMajorPerformanceCaveat could be created. */
  majorPerformanceCaveat: boolean;
  /** Unmasked renderer string; null when the browser does not expose it. */
  rendererName: string | null;
}

const UNMASKED_RENDERER_WEBGL = 0x9246;

function release(gl: WebGL2RenderingContext | null): void {
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}

export function probeGpu(): GpuProbe {
  try {
    const strict = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    const gl = strict ?? document.createElement('canvas').getContext('webgl2');
    if (gl === null) return { webgl: false, majorPerformanceCaveat: false, rendererName: null };
    const name: unknown = gl.getExtension('WEBGL_debug_renderer_info') === null ? null : gl.getParameter(UNMASKED_RENDERER_WEBGL);
    release(gl);
    return { webgl: true, majorPerformanceCaveat: strict === null, rendererName: typeof name === 'string' && name !== '' ? name : null };
  } catch {
    return { webgl: false, majorPerformanceCaveat: false, rendererName: null };
  }
}
