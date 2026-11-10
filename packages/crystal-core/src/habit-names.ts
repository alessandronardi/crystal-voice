// Italian habit names for the label (`CrystalGeometry.habitName`). Single
// table for crystal-core: the extension's UI strings module re-exports or
// overrides these, never inlines them (AGENTS.md §8). Thresholds only choose a
// name, never geometry, so they do not affect continuity.
//
// ADR-0019: habit-1 only combines first- and second-order prisms (every
// interior angle is 120° or 150°), so the labels say «smussato» and
// «doppio» instead of the strict forms ditrigonal {hk·0} and dihexagonal,
// which are reserved for a future geometry version.

import type { BuiltHabit } from './geometry/index.ts';

const NAME_EPS = 1e-9;
/** C distance below which the bevels count as a full second prism. [H] */
const DOUBLE_HEXAGONAL_BELOW = 1.03;

export const PRISM_NAMES = {
  trigonal: 'prisma trigonale',
  bevelledTrigonal: 'prisma trigonale smussato',
  hexagonal: 'prisma esagonale',
  bevelledHexagonal: 'prisma esagonale smussato',
  doubleHexagonal: 'prisma esagonale doppio',
} as const;

export const TERMINATION_NAMES = {
  pinacoid: 'con pinacoide',
  rhombohedron: 'con romboedro',
  bipyramid: 'con bipiramide esagonale',
} as const;

export function habitName(shape: BuiltHabit['shape']): string {
  const c0 = 2 / Math.sqrt(3);
  let prism: string;
  if (shape.dB >= 2 - NAME_EPS) prism = PRISM_NAMES.trigonal;
  else if (shape.dB > 1 + NAME_EPS) prism = PRISM_NAMES.bevelledTrigonal;
  else if (shape.dC >= c0 - NAME_EPS) prism = PRISM_NAMES.hexagonal;
  else if (shape.dC > DOUBLE_HEXAGONAL_BELOW) prism = PRISM_NAMES.bevelledHexagonal;
  else prism = PRISM_NAMES.doubleHexagonal;
  const termination = shape.rhombohedronP
    ? TERMINATION_NAMES.bipyramid
    : shape.rhombohedronR
      ? TERMINATION_NAMES.rhombohedron
      : TERMINATION_NAMES.pinacoid;
  return `${prism} ${termination}`;
}
