// Crystal geometry contract. Transcribed from SPEC v0.3 §10 ("Interfacce
// normative"). The schema is frozen at gate G2 as `habit-1`; until then a
// change here needs a spec/ADR change first (AGENTS.md §2, §10).

import type { DescriptorKey } from './seed.ts';

/** Geometry versions this build can generate and reopen (oldest first). */
export const GEOMETRY_VERSIONS = ['habit-1'] as const;
export type GeometryVersion = (typeof GEOMETRY_VERSIONS)[number];

/** Quantization unit of `CrystalBody.positions`: 2^-16 (ADR-0010). */
export const POSITION_UNITS_PER_LENGTH = 65536;

/** One face plane: the body is the intersection of all half-spaces normal·x ≤ distance. */
export interface FacePlane {
  /** Not normalized on purpose (ADR-0010): exact components, no trigonometry. */
  normal: readonly [number, number, number];
  distance: number;
  /** Crystallographic form the plane belongs to, e.g. 'prism-a', 'pinacoid'. */
  form: string;
}

export type CrystalBodyKind = 'primary' | 'secondary';

export interface CrystalBody {
  kind: CrystalBodyKind;
  /**
   * Definition: intersection of half-spaces. May include planes that do not
   * form a face (too far, tangent, or below the generator's minimum face
   * size): the faces are exactly the planes referenced by `faceOfTriangle`.
   * Floats, outside `geometryHash`.
   */
  planes: readonly FacePlane[];
  /** xyz quantized, unit = 2^-16, canonical order (sorted by x, y, z). */
  positions: Int32Array;
  /** Triangles, canonical order, CCW winding seen from outside. */
  indices: Uint32Array;
  /**
   * Index into `planes` of the face each triangle belongs to. Face normals for
   * shading and plates come from `planes[faceOfTriangle[i]].normal`, never from
   * the triangles: fans can contain thin triangles whose own normal deviates
   * (review I-10: up to ~17°) after quantization.
   */
  faceOfTriangle: Uint16Array;
}

export type InclusionKind = 'needle' | 'phantom';

/**
 * Inclusion primitives, mapped by `transform`:
 * - 'needle': unit cylinder of radius 1 along z with z ∈ [−½, ½] (the
 *   transform scales it to the needle's radius and length); both ends lie
 *   inside the primary body;
 * - 'phantom': a copy of `bodies[0]` (the primary), scaled about the origin.
 */
export interface Inclusion {
  kind: InclusionKind;
  /** 4×4 row-major affine transform, quantized (unit = 2^-16, so 65536 = 1.0). */
  transform: readonly number[];
}

export interface CrystalAppearance {
  /** OKLCH: lightness 0..1, chroma ≥ 0, hue degrees 0..360. Outside the geometric hash. */
  colorOklch: readonly [number, number, number];
  /** From p6. */
  zoningBands: number;
  /** Descriptors with confidence < 0.5 (ADR-0014). */
  veiledTraits: readonly DescriptorKey[];
}

export interface CrystalGeometry {
  geometryVersion: string;
  /** Italian habit name for the label, e.g. 'prisma esagonale doppio con romboedro' (ADR-0019). */
  habitName: string;
  /** [0] is the primary body. */
  bodies: readonly CrystalBody[];
  inclusions: readonly Inclusion[];
  appearance: CrystalAppearance;
  /** SHA-256 (lowercase hex) of the canonical bodies + inclusions. */
  geometryHash: string;
}

export function isGeometryVersion(value: unknown): value is GeometryVersion {
  return typeof value === 'string' && (GEOMETRY_VERSIONS as readonly string[]).includes(value);
}
