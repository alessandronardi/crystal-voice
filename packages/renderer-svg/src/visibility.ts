// Visible and hidden edges (SPEC §10, ADR-0013): on a convex body an edge is
// visible iff at least one of its two faces looks at the viewer. Face normals
// come from `planes`, never from the triangles (contract, review I-10 M1).
// Faces seen edge-on (|n·w| ≤ eps |n|) do not count as looking at the viewer.

import type { CrystalBody, PlatePreset } from '@voicecrystal/contracts';
import { featureEdges, type FeatureEdge } from './edges.ts';
import { dot, PROJECTIONS } from './projection.ts';

const FACING_EPS = 1e-9;

export function facesTowardViewer(body: CrystalBody, preset: PlatePreset): boolean[] {
  const w = PROJECTIONS[preset].toward;
  return body.planes.map((p) => {
    const n = p.normal;
    // Math.sqrt: correctly rounded (IEEE 754)
    return dot(n, w) > FACING_EPS * Math.sqrt(dot(n, n));
  });
}

export function classifyEdges(body: CrystalBody, preset: PlatePreset): { visible: FeatureEdge[]; hidden: FeatureEdge[] } {
  const facing = facesTowardViewer(body, preset);
  const visible: FeatureEdge[] = [];
  const hidden: FeatureEdge[] = [];
  for (const e of featureEdges(body)) {
    (facing[e.f1] === true || facing[e.f2] === true ? visible : hidden).push(e);
  }
  return { visible, hidden };
}
