// @voicecrystal/crystal-core — half-space crystal generator (SPEC §10).
// Pure package: no chrome.*, DOM, window or Three.js (AGENTS.md R10).
export { buildAppearance, colorFromBrightness, VEIL_BELOW, zoningBandsFromRhythm } from './appearance.ts';
export { generateCrystalGeometry, GeometryInputError, MAX_TRIANGLES } from './generate.ts';
export { canonicalGeometryBytes, geometryHash } from './hash.ts';
export { habitName, PRISM_NAMES, TERMINATION_NAMES } from './habit-names.ts';
export { HABIT_1, MAX_NEEDLES, MAX_SECONDARIES, NOISE_CELL, sha256, toHex } from './geometry/index.ts';
