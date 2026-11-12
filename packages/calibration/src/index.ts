// @voicecrystal/calibration — quantile tables (ADR-0006) and the canonical seed (SPEC §7.5).
// Pure package: no chrome.*, DOM, window or Three.js (AGENTS.md R10).
export { CalibrationError, type CalibrationErrorCode } from './errors.ts';
export { roundHalfEven, toSeedUnits } from './seed-units.ts';
export {
  MAPPING_0,
  MAPPING_0_VERSION,
  mapToPoint,
  parseMappingTable,
  seedFromRaw,
  type MappedSeed,
  type MappingTable,
  type ParameterTable,
} from './mapping.ts';
