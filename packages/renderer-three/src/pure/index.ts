// Pure core of renderer-three: no Three.js, DOM or chrome.* (AGENTS.md R10,
// enforced by tooling/eslint/purity.js). Tested in Node.
export { checkBudget, MAX_PHANTOMS } from './budget.ts';
export { mixRgb, oklabToLinearSrgb, oklchToLinearSrgb, type Rgb } from './color.ts';
export { RenderInputError, type RenderInputErrorCode } from './errors.ts';
export { dequantizeTransform, needleMatrices, phantomMatrices } from './inclusions.ts';
export {
  BAND_CONTRAST,
  BAND_CONTRAST_VEILED,
  ECONOMY_OPACITY,
  FRAMING_RADIUS,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_TARGETS,
  highlightAvailable,
  highlightTargetOf,
  INCLUSION_FADE,
  INCLUSION_FADE_VEILED,
  NEEDLE_RADIUS_FACTOR_VEILED,
  paletteFor,
  roughnessFor,
  ROUGHNESS_FROSTED,
  ROUGHNESS_POLISHED,
  SECONDARY_VEILED_OPACITY,
  SECONDARY_VEILED_TRANSMISSION,
  turntableAngle,
  TURNTABLE_PERIOD_MS,
  veilFromTraits,
  veilIsVisible,
  VEILED_CHROMA_FACTOR,
  VETRINA_MATERIAL,
  zoningTexels,
  type HighlightTarget,
  type Palette,
  type RenderProfile,
  type Veil,
} from './look.ts';
export {
  chooseProfile,
  FRAME_COST_P95_LIMIT_MS,
  frameCostP95,
  isSoftwareRenderer,
  PROFILE_SAMPLE_FRAMES,
  type ProfileChoice,
  type ProfileInput,
  type ProfileReason,
} from './profile.ts';
export {
  bodyToMeshArrays,
  boundingRadius,
  FACE_CLASSES,
  faceClassOf,
  unitPlaneNormals,
  zoningUvs,
  zRange,
  type FaceClass,
  type MeshArrays,
  type MeshGroup,
} from './mesh-arrays.ts';
