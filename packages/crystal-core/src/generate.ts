// generateCrystalGeometry (SPEC §10): pure, synchronous, deterministic.
// Each geometryVersion keeps its generator forever: saved records must reopen
// identically (packages/crystal-core/CLAUDE.md).

import {
  isCrystalSeed,
  type CrystalBody,
  type CrystalGeometry,
  type CrystalSeed,
  type Inclusion,
  type SeedConfidence,
} from '@voicecrystal/contracts';
import { buildAppearance } from './appearance.ts';
import { buildHabit1, HABIT_1 } from './geometry/index.ts';
import { geometryHash } from './hash.ts';
import { habitName } from './habit-names.ts';

/** Triangle budget per geometry. [H] (SPEC §10, packages/crystal-core/CLAUDE.md) */
export const MAX_TRIANGLES = 4000;

export class GeometryInputError extends Error {
  override readonly name = 'GeometryInputError';
  readonly code: 'INVALID_SEED' | 'INVALID_CONFIDENCE' | 'UNKNOWN_GEOMETRY_VERSION' | 'TRIANGLE_BUDGET_EXCEEDED';
  constructor(code: GeometryInputError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function isConfidence(value: unknown): value is SeedConfidence {
  if (!Array.isArray(value) || value.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    const v: unknown = value[i];
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) return false;
  }
  return true;
}

function generateHabit1(seed: CrystalSeed, confidence: SeedConfidence): CrystalGeometry {
  const built = buildHabit1({ units: [seed[0], seed[1], seed[2], seed[3]] });
  const bodies: CrystalBody[] = built.bodies.map((b) => ({
    kind: b.kind,
    planes: b.planes.map((p) => ({ normal: p.normal, distance: p.distance, form: p.form })),
    positions: b.mesh.positions,
    indices: b.mesh.indices,
    faceOfTriangle: b.mesh.faceOfTriangle,
  }));
  const triangles = bodies.reduce((n, b) => n + b.faceOfTriangle.length, 0);
  if (triangles > MAX_TRIANGLES) {
    throw new GeometryInputError('TRIANGLE_BUDGET_EXCEEDED', `${triangles} triangles > ${MAX_TRIANGLES}`);
  }
  const inclusions: Inclusion[] = built.inclusions.map((i) => ({ kind: i.kind, transform: i.transform }));
  return {
    geometryVersion: HABIT_1,
    habitName: habitName(built.shape),
    bodies,
    inclusions,
    appearance: buildAppearance(seed, confidence),
    geometryHash: geometryHash(HABIT_1, bodies, inclusions),
  };
}

const GENERATORS: Readonly<Record<string, (seed: CrystalSeed, confidence: SeedConfidence) => CrystalGeometry>> = {
  [HABIT_1]: generateHabit1,
};

export function generateCrystalGeometry(seed: CrystalSeed, confidence: SeedConfidence, geometryVersion: string): CrystalGeometry {
  if (!isCrystalSeed(seed)) throw new GeometryInputError('INVALID_SEED', 'seed must be six integers in [0, 10000]');
  if (!isConfidence(confidence)) throw new GeometryInputError('INVALID_CONFIDENCE', 'confidence must be six numbers in [0, 1]');
  const generator = Object.hasOwn(GENERATORS, geometryVersion) ? GENERATORS[geometryVersion] : undefined;
  if (generator === undefined) throw new GeometryInputError('UNKNOWN_GEOMETRY_VERSION', `unknown geometryVersion "${geometryVersion}"`);
  return generator(seed, confidence);
}
