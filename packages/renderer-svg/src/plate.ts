// renderPlateSvg (SPEC §10, ADR-0013): orthographic line drawing of the
// primary body, hidden edges dashed. Pure and deterministic: the same geometry
// and view give the same string byte for byte, in Node and in browsers, for a
// given PLATE_RENDERER_VERSION.

import {
  isPlateView,
  PLATE_RENDERER_VERSION,
  POSITION_UNITS_PER_LENGTH,
  type CrystalBody,
  type CrystalGeometry,
  type PlatePreset,
  type PlateView,
} from '@voicecrystal/contracts';
import type { FeatureEdge } from './edges.ts';
import { PlateViewError } from './errors.ts';
import { escapeXml, formatCoord } from './format.ts';
import { PLATE_STRINGS } from './plate-strings.ts';
import { dot, plateScale, PROJECTIONS, type Vec3 } from './projection.ts';
import { classifyEdges } from './visibility.ts';

/** Stroke widths and dash on a 512 px plate; they scale with sizePx, so every size looks the same. */
const STROKE_VISIBLE_512 = 1.25;
const STROKE_HIDDEN_512 = 0.75;
const DASH_512: readonly [number, number] = [4, 3];

/** Throws on a body that is not a well-formed indexed mesh (no silent fallbacks). */
function checkBody(body: CrystalBody): void {
  const vertices = body.positions.length / 3;
  const triangles = body.faceOfTriangle.length;
  const ok =
    Number.isInteger(vertices) &&
    body.indices.length === 3 * triangles &&
    body.indices.every((i) => i < vertices) &&
    body.faceOfTriangle.every((f) => f < body.planes.length);
  if (!ok) throw new PlateViewError('INVALID_GEOMETRY', 'malformed primary body: positions, indices, faceOfTriangle and planes disagree');
}

/** Path data of the edges; segments whose two rounded endpoints coincide (edges seen end-on, or < 0.01 px) are skipped. */
function pathData(body: CrystalBody, edges: readonly FeatureEdge[], preset: PlatePreset, sizePx: number): string {
  const { right, up } = PROJECTIONS[preset];
  const k = plateScale(sizePx);
  const half = sizePx / 2;
  const point = (i: number): string => {
    const p: Vec3 = [
      (body.positions[3 * i] as number) / POSITION_UNITS_PER_LENGTH,
      (body.positions[3 * i + 1] as number) / POSITION_UNITS_PER_LENGTH,
      (body.positions[3 * i + 2] as number) / POSITION_UNITS_PER_LENGTH,
    ];
    return `${formatCoord(half + k * dot(right, p))} ${formatCoord(half - k * dot(up, p))}`;
  };
  let d = '';
  for (const e of edges) {
    const a = point(e.a);
    const b = point(e.b);
    if (a !== b) d += `M${a}L${b}`;
  }
  return d;
}

export function renderPlateSvg(geometry: CrystalGeometry, view: PlateView): string {
  if (!isPlateView(view)) throw new PlateViewError('INVALID_VIEW', 'invalid PlateView: preset or sizePx out of range');
  const body = geometry.bodies[0];
  if (body?.kind !== 'primary') throw new PlateViewError('NO_PRIMARY', 'the geometry has no primary body');
  checkBody(body);
  const { preset, sizePx } = view;
  const { visible, hidden } = classifyEdges(body, preset);
  const size = String(sizePx);
  const px = (v512: number): string => formatCoord((v512 * sizePx) / 512);
  const desc = PLATE_STRINGS.desc({
    renderer: PLATE_RENDERER_VERSION,
    preset,
    visible: visible.length,
    hidden: hidden.length,
    geometryVersion: geometry.geometryVersion,
    hash16: geometry.geometryHash.slice(0, 16),
  });
  const hiddenD = pathData(body, hidden, preset, sizePx);
  const hiddenPath =
    hiddenD === '' ? '' : `<path stroke-width="${px(STROKE_HIDDEN_512)}" stroke-dasharray="${px(DASH_512[0])} ${px(DASH_512[1])}" d="${hiddenD}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">` +
    `<title>${escapeXml(geometry.habitName)}</title><desc>${escapeXml(desc)}</desc>` +
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">` +
    hiddenPath +
    `<path stroke-width="${px(STROKE_VISIBLE_512)}" d="${pathData(body, visible, preset, sizePx)}"/>` +
    `</g></svg>`
  );
}
