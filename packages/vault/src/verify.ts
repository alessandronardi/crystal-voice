// Geometry regeneration and integrity/budget verification for saved & imported records (SPEC §12, R17).

import type { CrystalGeometry, CrystalRecordV1 } from '@voicecrystal/contracts';
import { generateCrystalGeometry, geometryHash, GeometryInputError } from '@voicecrystal/crystal-core';
import { checkBudget, RenderInputError } from '@voicecrystal/renderer-three';
import { VaultError } from './errors.ts';

export interface VerifyGeometryDeps {
  generate?: typeof generateCrystalGeometry;
  hash?: typeof geometryHash;
  budget?: typeof checkBudget;
}

/**
 * Rebuilds geometry deterministically from the persisted seed/confidence/version,
 * validates the renderer resource budget, and verifies `geometryHash`.
 */
export function verifyRecordGeometry(
  record: CrystalRecordV1,
  deps: VerifyGeometryDeps = {},
): CrystalGeometry {
  const generate = deps.generate ?? generateCrystalGeometry;
  const hash = deps.hash ?? geometryHash;
  const budget = deps.budget ?? checkBudget;

  let geometry: CrystalGeometry;
  try {
    geometry = generate(record.seed, record.confidence, record.geometryVersion);
  } catch (error) {
    if (error instanceof GeometryInputError) {
      throw new VaultError('INVALID_SCHEMA', error.message, { cause: error });
    }
    throw error;
  }

  try {
    budget(geometry);
  } catch (error) {
    if (error instanceof RenderInputError && error.code === 'BUDGET_EXCEEDED') {
      throw new VaultError('BUDGET_EXCEEDED', error.message, { cause: error });
    }
    throw new VaultError('BUDGET_EXCEEDED', 'Geometry resource budget check failed', { cause: error });
  }

  const actualHash = hash(geometry.geometryVersion, geometry.bodies, geometry.inclusions);
  if (actualHash !== record.geometryHash) {
    throw new VaultError(
      'GEOMETRY_HASH_MISMATCH',
      `geometryHash mismatch for crystal ${record.id}: expected ${record.geometryHash}, got ${actualHash}`,
    );
  }

  return geometry;
}
