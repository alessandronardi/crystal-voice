// @voicecrystal/renderer-svg — crystallographic plate (SPEC §10, ADR-0013).
// Pure package: no chrome.*, DOM, window or Three.js (AGENTS.md R10).
export { featureEdges, type FeatureEdge } from './edges.ts';
export { PlateViewError, type PlateErrorCode } from './errors.ts';
export { escapeXml, formatCoord } from './format.ts';
export { renderPlateSvg } from './plate.ts';
export { PLATE_STRINGS } from './plate-strings.ts';
export { PLATE_SCALE_512, plateScale, PROJECTIONS, type Projection, type Vec3 } from './projection.ts';
export { classifyEdges, facesTowardViewer } from './visibility.ts';
