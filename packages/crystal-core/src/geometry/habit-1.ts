// geometryVersion 'habit-1': mapping from (p1..p4) to half-space bodies
// (SPEC §10 "Mapping geometrico", ADR-0005). Every constant is [H], to be tuned
// at gate G2 by visual review; changing any of them changes the golden hashes
// and requires a new geometryVersion.
//
// Faces only appear by planes moving towards the solid: no floor/round on a
// parameter decides whether a face exists (ADR-0005). Randomness comes from
// continuous lattice noise (ADR-0018). Vertex path: + − × ÷ and Math.sqrt.

import { intersectHalfSpaces, UNITS, type Plane, type Polytope } from './halfspace.ts';
import { DIRECTIONS_30, IDENTITY, mulMatVec, quaternionToMatrix, SQRT3, dot, type Mat3, type Vec3 } from './linear.ts';
import { continuousNoise } from './noise.ts';

export const HABIT_1 = 'habit-1';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (x: number, from: number, to: number): number => clamp01((x - from) / (to - from));

/** Prism family directions (indices into DIRECTIONS_30). */
const DIR_A = [0, 4, 8] as const; // 0°, 120°, 240°
const DIR_B = [2, 6, 10] as const; // 60°, 180°, 300°
const DIR_C = [1, 3, 5, 7, 9, 11] as const; // 30° + 60°k

const C_START = 2 / SQRT3; // C planes touch the regular hexagon's vertices

// --- p1: prism path -----------------------------------------------------------
// t1 ∈ [0, 0.4]: B from 2 (touching the triangle's vertices) to 1 — trigonal →
// bevelled trigonal → hexagonal; C follows the vertices it would touch, (1 + dB)/√3.
// t1 ∈ [0.4, 0.5]: hexagonal plateau. t1 ∈ [0.5, 0.9]: C from 2/√3 to 1 —
// bevelled hexagonal → double hexagonal (12 faces, ADR-0019). t1 ∈ [0.9, 1]: plateau.
export function prismDistances(t1: number): { dB: number; dC: number } {
  const dB = 2 - ramp(t1, 0, 0.4);
  const dC = t1 < 0.5 ? (1 + dB) / SQRT3 : C_START - (C_START - 1) * ramp(t1, 0.5, 0.9);
  return { dB, dC };
}

// --- p2: terminations -----------------------------------------------------------
// A face of direction u and steepness c has normal (u, ±c) and passes through
// the prism wall (support s(u)) at height ±(h + δ). δ > 0: the face misses the
// solid; it emerges at δ = 0 on the rim and grows as δ decreases.
//   rhombohedron R: top at A, bottom at B; emerges at t2 = 0.3.
//   second rhombohedron P (with R: hexagonal bipyramid): top at B, bottom at A.
export function terminationParams(t2: number): { c: number; deltaR: number; deltaP: number } {
  return {
    c: 1.6 - 0.6 * t2,
    deltaR: 0.3 - 1.0 * t2,
    deltaP: 0.3 - 0.9 * ramp(t2, 0.3, 1),
  };
}

/**
 * Half-height of the prism (elongation c/a) from p3. Quadratic, so that the
 * relative change per step stays small at the tabular end (continuity).
 */
export const halfHeight = (t3: number): number => 0.8 + 1.6 * t3 * t3;

/**
 * Area of the basal cross-section for prism distances (dB, dC) with A at 1:
 * the unit-inradius triangle (3√3) minus its three corners cut by B (each
 * (2 − dB)²/√3), minus the six hexagon corners cut by C once dB = 1 (each
 * √3·e², e = 2/√3 − dC). C only touches while dB > 1.
 */
export function crossSectionArea(dB: number, dC: number): number {
  const b = 2 - dB;
  const e = C_START - dC > 0 && dB <= 1 ? C_START - dC : 0;
  return 3 * SQRT3 - (3 * b * b) / SQRT3 - 6 * SQRT3 * e * e;
}

/**
 * Horizontal scale keeping the cross-section area equal to the regular
 * hexagon's (2√3): the path changes shape, not size (continuity, ADR-0005).
 * Math.sqrt is correctly rounded (IEEE 754), allowed in the vertex path.
 */
export const crossSectionScale = (dB: number, dC: number): number => Math.sqrt((2 * SQRT3) / crossSectionArea(dB, dC));

export interface HabitInputs {
  /** Seed units of p1..p4 (integers 0..10000). */
  units: readonly [number, number, number, number];
}

/** Local planes of one body of the habit (centred at the origin, c-axis = z). */
export function habitPlanes(t1: number, t2: number, t3: number): Plane[] {
  const { dB, dC } = prismDistances(t1);
  const sigma = crossSectionScale(dB, dC);
  const h = halfHeight(t3);
  const { c, deltaR, deltaP } = terminationParams(t2);
  const planes: Plane[] = [];
  const support = (k: number): number => sigma * ((DIR_A as readonly number[]).includes(k) ? 1 : dB);
  for (const k of DIR_A) {
    const [x, y] = DIRECTIONS_30[k] ?? [1, 0];
    planes.push({ normal: [x, y, 0], distance: sigma, form: 'prism-a' });
  }
  for (const k of DIR_B) {
    const [x, y] = DIRECTIONS_30[k] ?? [1, 0];
    planes.push({ normal: [x, y, 0], distance: sigma * dB, form: 'prism-b' });
  }
  for (const k of DIR_C) {
    const [x, y] = DIRECTIONS_30[k] ?? [1, 0];
    planes.push({ normal: [x, y, 0], distance: sigma * dC, form: 'prism-c' });
  }
  planes.push({ normal: [0, 0, 1], distance: h, form: 'pinacoid' });
  planes.push({ normal: [0, 0, -1], distance: h, form: 'pinacoid' });
  const termination = (k: number, sign: 1 | -1, delta: number, form: string): void => {
    const [x, y] = DIRECTIONS_30[k] ?? [1, 0];
    planes.push({ normal: [x, y, sign * c], distance: support(k) + c * (h + delta), form });
  };
  for (const k of DIR_A) termination(k, 1, deltaR, 'rhombohedron-r');
  for (const k of DIR_B) termination(k, -1, deltaR, 'rhombohedron-r');
  for (const k of DIR_B) termination(k, 1, deltaP, 'rhombohedron-p');
  for (const k of DIR_A) termination(k, -1, deltaP, 'rhombohedron-p');
  return planes;
}

/** Rotate, scale and translate local planes: x_world = R·(s·x_local) + t. */
export function transformPlanes(planes: readonly Plane[], r: Mat3, scale: number, t: Vec3): Plane[] {
  return planes.map((p) => {
    const n = mulMatVec(r, p.normal);
    return { normal: n, distance: scale * p.distance + dot(n, t), form: p.form };
  });
}

/** Point on the unit circle from a real parameter (rational parametrization: continuous, no trig). */
function circle(s: number): [number, number] {
  const d = 1 + s * s;
  return [(1 - s * s) / d, (2 * s) / d];
}

const signed = (v: number | undefined): number => 2 * (v ?? 0.5) - 1;

export interface BuiltBody {
  kind: 'primary' | 'secondary';
  planes: Plane[];
  mesh: Polytope;
}

export interface BuiltInclusion {
  kind: 'needle' | 'phantom';
  /** 4×4 row-major, quantized to 2^-16 units. */
  transform: number[];
}

export interface BuiltHabit {
  bodies: BuiltBody[];
  inclusions: BuiltInclusion[];
  /** Values the habit name is derived from. */
  shape: { dB: number; dC: number; rhombohedronR: boolean; rhombohedronP: boolean };
}

export const MAX_SECONDARIES = 3;
/** Smallest secondary scale that is generated (relative to the primary). [H] */
export const MIN_SECONDARY_SIZE = 0.001;
export const MAX_NEEDLES = 10;
/** Needle radius in length units. [H] */
export const NEEDLE_RADIUS = 0.02;
const SECONDARY_CHANNELS = 5;
const NEEDLE_CHANNELS = 7;

function quantizedTransform(r: Mat3, sx: number, sy: number, sz: number, t: Vec3): number[] {
  const m = [
    r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, t[0],
    r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, t[1],
    r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, t[2],
    0, 0, 0, 1,
  ];
  return m.map((v) => Math.round(v * UNITS));
}

export function buildHabit1(inputs: HabitInputs): BuiltHabit {
  const [u1, u2, u3, u4] = inputs.units;
  const t1 = u1 / 10000;
  const t2 = u2 / 10000;
  const t3 = u3 / 10000;
  const t4 = u4 / 10000;
  const h = halfHeight(t3);
  const local = habitPlanes(t1, t2, t3);

  // No global orientation: a rotation of the whole crystal moves the whole
  // silhouette and failed the continuity test; the view is the renderer's.
  const global = IDENTITY;

  const bodies: BuiltBody[] = [];
  const primaryPlanes = transformPlanes(local, global, 1, [0, 0, 0]);
  bodies.push({ kind: 'primary', planes: primaryPlanes, mesh: intersectHalfSpaces(primaryPlanes) });

  // Secondaries: same habit, born at size 0 as p3 crosses each threshold τ_k.
  // Each sits on a fixed slot (exact direction 30°·(4k + 1), at 90% of the
  // rim distance in that direction, fixed outward tilt); the noise only
  // perturbs height, spin and tilt a little, so that a
  // 100-unit step moves them by a fraction of their size (continuity).
  const sec = continuousNoise(HABIT_1, 'secondary', inputs.units, MAX_SECONDARIES * SECONDARY_CHANNELS);
  for (let k = 0; k < MAX_SECONDARIES; k++) {
    const n = (i: number): number | undefined => sec[k * SECONDARY_CHANNELS + i];
    const tau = 0.25 + 0.45 * (n(0) ?? 0.5);
    const size = 0.45 * ramp(t3, tau, tau + 0.5);
    // A secondary is born at MIN_SECONDARY_SIZE, not exactly 0: below it the
    // body would be narrower than the tiny-face threshold of halfspace.ts and
    // degenerate. At birth it is ~200 quantization units (~0.003 length
    // units, ~0.1% of the crystal's width), below visibility (review I-10, H1).
    if (size < MIN_SECONDARY_SIZE) continue;
    const [dx, dy] = DIRECTIONS_30[4 * k + 1] ?? [1, 0];
    const rim = rimDistance(local, dx, dy);
    const position: Vec3 = [0.9 * rim * dx, 0.9 * rim * dy, 0.25 * h * signed(n(1))];
    // Base tilt of 0.4 rad-ish outwards about the axis perpendicular to the slot, plus small jitter.
    const local2world = quaternionToMatrix(1, -0.35 * dy + 0.15 * signed(n(2)), 0.35 * dx + 0.15 * signed(n(3)), 0.2 * signed(n(4)));
    const r = compose(global, local2world);
    const planes = transformPlanes(local, r, size, mulMatVec(global, position));
    bodies.push({ kind: 'secondary', planes, mesh: intersectHalfSpaces(planes) });
  }

  // Inclusions (p4): needles born at length 0 as p4 crosses τ_i; one phantom.
  const inc = continuousNoise(HABIT_1, 'inclusions', inputs.units, MAX_NEEDLES * NEEDLE_CHANNELS);
  const inclusions: BuiltInclusion[] = [];
  for (let i = 0; i < MAX_NEEDLES; i++) {
    const n = (j: number): number | undefined => inc[i * NEEDLE_CHANNELS + j];
    const tau = 0.1 + 0.8 * (n(0) ?? 0.5);
    const grown = 0.6 * h * ramp(t4, tau, tau + 0.2);
    if (grown === 0) continue;
    const [cx, cy] = circle(2 * signed(n(1)));
    const radial = 0.5 * rimDistance(local, cx, cy) * (n(2) ?? 0.5);
    const position: Vec3 = mulMatVec(global, [radial * cx, radial * cy, 0.5 * h * signed(n(3))]);
    const r = compose(global, quaternionToMatrix(1, 1.2 * signed(n(4)), 1.2 * signed(n(5)), 1.2 * signed(n(6))));
    // Needle = unit segment z ∈ [−½, ½] scaled by `length`, centred at `position`
    // (contract: Inclusion). Both ends stay inside the primary: the length is
    // capped by every face plane (continuous: a min of continuous terms).
    const direction: Vec3 = [r[0][2], r[1][2], r[2][2]];
    const length = Math.min(grown, 0.95 * maxSegmentLength(primaryPlanes, position, direction));
    if (!(length > 0)) continue;
    inclusions.push({ kind: 'needle', transform: quantizedTransform(r, NEEDLE_RADIUS, NEEDLE_RADIUS, length, position) });
  }
  const phantom = 0.85 * ramp(t4, 0.2, 0.7);
  if (phantom > 0) inclusions.push({ kind: 'phantom', transform: quantizedTransform(global, phantom, phantom, phantom, [0, 0, 0]) });

  const { dB, dC } = prismDistances(t1);
  const { deltaR, deltaP } = terminationParams(t2);
  return { bodies, inclusions, shape: { dB, dC, rhombohedronR: deltaR < 0, rhombohedronP: deltaP < 0 } };
}

/**
 * Distance from the axis to the prism wall along the basal direction (dx, dy):
 * min over vertical planes facing that way of d / (n·u). Divisions only, and
 * continuous in the plane distances, so secondaries sit on the actual rim.
 */
function rimDistance(planes: readonly Plane[], dx: number, dy: number): number {
  let best = Infinity;
  for (const p of planes) {
    if (p.normal[2] !== 0) continue;
    const c = p.normal[0] * dx + p.normal[1] * dy;
    if (c > 0) best = Math.min(best, p.distance / c);
  }
  return best;
}

/**
 * Longest segment centred at `centre` along `direction` that stays inside all
 * planes: 2·min over planes of slack / |n·dir|. 0 if the centre is outside.
 */
function maxSegmentLength(planes: readonly Plane[], centre: Vec3, direction: Vec3): number {
  let half = Infinity;
  for (const p of planes) {
    const slack = p.distance - dot(p.normal, centre);
    if (slack <= 0) return 0;
    const along = dot(p.normal, direction);
    const a = along < 0 ? -along : along;
    if (a > 0) half = Math.min(half, slack / a);
  }
  return 2 * half;
}

/** Matrix product a·b. */
function compose(a: Mat3, b: Mat3): Mat3 {
  const c0: Vec3 = [b[0][0], b[1][0], b[2][0]];
  const c1: Vec3 = [b[0][1], b[1][1], b[2][1]];
  const c2: Vec3 = [b[0][2], b[1][2], b[2][2]];
  const row = (r: Vec3): Vec3 => [dot(r, c0), dot(r, c1), dot(r, c2)];
  return [row(a[0]), row(a[1]), row(a[2])];
}
