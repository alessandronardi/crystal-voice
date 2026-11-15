// @voicecrystal/comparator — nearness percentile (SPEC §11, ADR-0007, G0-DOC-02).
// Pure package: no chrome.*, DOM, window, IndexedDB, or Three.js (AGENTS.md R10).
export { ComparatorError, type ComparatorErrorCode } from './errors.ts';
export {
  COMPARATOR_0,
  COMPARATOR_0_VERSION,
  EQUAL_WEIGHTS,
  evaluateDistanceCdf,
  parseComparatorTable,
  type ComparatorTable,
  type ComparatorWeights,
} from './table.ts';
export {
  compareSeeds,
  compareSpecimens,
  computeParameterContributions,
  euclideanAffinity,
  nearnessFromDistance,
  weightedEuclideanDistance,
  type ComparableSpecimen,
  type ComparisonBlockReason,
  type ComparisonContextWarning,
  type ParameterContribution,
  type SeedComparisonResult,
  type SixContributions,
  type SpecimenComparisonOutcome,
} from './compare.ts';
