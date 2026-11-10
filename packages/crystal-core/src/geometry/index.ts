// Vertex path of crystal-core (ADR-0010). Lint-enforced: only + - * / and
// Math.sqrt (correctly rounded per IEEE 754); no Math.random, Date, clocks,
// Math.sin/cos/tan/exp/pow/log and similar; no imports from outside geometry/.
export { buildHabit1, HABIT_1, MAX_NEEDLES, MAX_SECONDARIES, type BuiltHabit } from './habit-1.ts';
export { intersectHalfSpaces, PolytopeError, UNITS, type Plane, type Polytope } from './halfspace.ts';
export { NOISE_CELL } from './noise.ts';
export { asciiBytes, sha256, toHex } from './sha256.ts';
