// Fallback without WebGL: the SVG plate of renderer-svg (ADR-0013), the
// canonical export. Parsed with DOMParser and imported as nodes: never
// innerHTML (AGENTS.md R17), even if the plate comes from our own renderer.

import { DEFAULT_PLATE_VIEW, type CrystalGeometry } from '@voicecrystal/contracts';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';

export function showPlateFallback(container: HTMLElement, geometry: CrystalGeometry, sizePx: number): void {
  const svg = renderPlateSvg(geometry, { ...DEFAULT_PLATE_VIEW, sizePx });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg') {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(container.ownerDocument.importNode(root, true));
}
