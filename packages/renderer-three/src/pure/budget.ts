// Defensive resource budget (SPEC §10 "limiti su numero triangoli e memoria").
// The generator already enforces these limits; the renderer checks them again
// because a geometry can also come from an imported record (I-14), which is
// untrusted (AGENTS.md R17). Pure.

import type { CrystalGeometry } from '@voicecrystal/contracts';
import { MAX_NEEDLES, MAX_SECONDARIES, MAX_TRIANGLES } from '@voicecrystal/crystal-core';
import { RenderInputError } from './errors.ts';

/** At most one phantom per crystal in habit-1. */
export const MAX_PHANTOMS = 1;

export function checkBudget(geometry: CrystalGeometry): void {
  const triangles = geometry.bodies.reduce((n, b) => n + b.faceOfTriangle.length, 0);
  if (triangles > MAX_TRIANGLES) {
    throw new RenderInputError('BUDGET_EXCEEDED', `${triangles} triangles > ${MAX_TRIANGLES}`);
  }
  const secondaries = geometry.bodies.filter((b) => b.kind === 'secondary').length;
  if (geometry.bodies.length === 0 || geometry.bodies[0]?.kind !== 'primary' || secondaries > MAX_SECONDARIES || secondaries !== geometry.bodies.length - 1) {
    throw new RenderInputError('BUDGET_EXCEEDED', `bodies: one primary first and at most ${MAX_SECONDARIES} secondaries`);
  }
  const needles = geometry.inclusions.filter((i) => i.kind === 'needle').length;
  const phantoms = geometry.inclusions.filter((i) => i.kind === 'phantom').length;
  if (needles > MAX_NEEDLES || phantoms > MAX_PHANTOMS) {
    throw new RenderInputError('BUDGET_EXCEEDED', `${needles} needles (max ${MAX_NEEDLES}), ${phantoms} phantoms (max ${MAX_PHANTOMS})`);
  }
}
