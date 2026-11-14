// PNG 1024×1024 specimen export and 256×256 WebP thumbnail rendering (SPEC §10, §12, ADR-0012).

import { VAULT_PNG_SIZE, VAULT_THUMBNAIL_SIZE, type CrystalGeometry } from '@voicecrystal/contracts';
import { checkBudget } from './pure/index.ts';
import { getSnapshotHook, renderCrystal, type RenderHandle } from './render.ts';

export type RenderExportErrorCode = 'INVALID_SIZE' | 'HANDLE_DISPOSED' | 'WEBGL_UNAVAILABLE' | 'EXPORT_FAILED';

export class RenderExportError extends Error {
  readonly code: RenderExportErrorCode;

  constructor(code: RenderExportErrorCode, message: string) {
    super(message);
    this.name = 'RenderExportError';
    this.code = code;
  }
}

function validateSize(sizePx: number): void {
  if (!Number.isInteger(sizePx) || sizePx < 1 || sizePx > 4096) {
    throw new RenderExportError('INVALID_SIZE', `Invalid export image size: ${sizePx}`);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, mimeType, quality);
  });
}

/**
 * Exports a square orthographic PNG image from an active WebGL showcase handle
 * and restores the handle's size, pixel ratio, highlight, and angle immediately.
 */
export async function exportCrystalPng(handle: RenderHandle, sizePx: number = VAULT_PNG_SIZE): Promise<Blob> {
  validateSize(sizePx);
  if (handle.state === 'disposed') {
    throw new RenderExportError('HANDLE_DISPOSED', 'Cannot export PNG from a disposed RenderHandle');
  }
  if (handle.state !== 'webgl') {
    throw new RenderExportError('WEBGL_UNAVAILABLE', `Cannot export WebGL PNG while showcase state is ${handle.state}`);
  }
  const snapshot = getSnapshotHook(handle);
  if (snapshot === undefined) {
    throw new RenderExportError('HANDLE_DISPOSED', 'Missing snapshot hook for RenderHandle');
  }
  const outCanvas = snapshot(sizePx);
  if (outCanvas === null) {
    throw new RenderExportError('EXPORT_FAILED', 'Failed to capture orthographic canvas');
  }
  const blob = await canvasToBlob(outCanvas, 'image/png');
  if (blob === null) {
    throw new RenderExportError('EXPORT_FAILED', 'Canvas PNG encoding returned null');
  }
  return blob;
}

/**
 * Renders a 256×256 WebP thumbnail offscreen for IndexedDB storage (SPEC §12).
 * Returns `null` when DOM or WebGL is unavailable, after disposing all GPU resources.
 */
export async function renderCrystalThumbnail(
  geometry: CrystalGeometry,
  sizePx: number = VAULT_THUMBNAIL_SIZE,
): Promise<Blob | null> {
  validateSize(sizePx);
  // Always validate geometry budget even when DOM/WebGL is absent (untrusted import defence).
  checkBudget(geometry);
  if (typeof document === 'undefined') return null;

  const container = document.createElement('div');
  const handle = renderCrystal(geometry, {
    container,
    profile: 'economy',
    reducedMotion: true,
    sizePx,
  });

  try {
    if (handle.state !== 'webgl') return null;
    const snapshot = getSnapshotHook(handle);
    const outCanvas = snapshot?.(sizePx) ?? null;
    if (outCanvas === null) return null;
    const blob = await canvasToBlob(outCanvas, 'image/webp', 0.85);
    if (blob === null || blob.type !== 'image/webp') return null;
    return blob;
  } finally {
    handle.dispose();
  }
}
