// Showcase scene (SPEC §10 "Profilo visivo vetrina", ADR-0012, D-AV), Three.js 0.186.1.
//
// Everything created here is registered in `disposables` and released by
// `dispose()`. No external asset: the environment is RoomEnvironment through
// PMREM, and both the zoning bands and the radial warm-ink glow are DataTextures.
//
// What the transmission pass sees: in 0.186.1 the transmission render target
// holds opaque objects only (WebGLRenderer.renderTransmissionPass), so needles
// and phantom outlines are opaque to stay visible through the crystal; the
// zoning bands are textures on the crystal itself (colour and transmissionMap).

import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  FrontSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { POSITION_UNITS_PER_LENGTH, type CrystalBody, type CrystalGeometry } from '@voicecrystal/contracts';
import { featureEdges } from '@voicecrystal/renderer-svg';
import {
  bodyToMeshArrays,
  boundingRadius,
  checkBudget,
  crystalScale,
  ECONOMY_OPACITY,
  EDGE_FRONT_OPACITY,
  EDGE_THROUGH_OPACITY,
  FACE_CLASSES,
  FRAMING_RADIUS,
  GLOW_SIZE,
  glowTexels,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_TARGETS,
  mixRgb,
  NEEDLE_RADIUS_FACTOR_VEILED,
  needleMatrices,
  paletteFor,
  phantomMatrices,
  RenderInputError,
  RIM_LIGHT_INTENSITY,
  roughnessFor,
  ROUGHNESS_POLISHED,
  SECONDARY_VEILED_OPACITY,
  SECONDARY_VEILED_TRANSMISSION,
  SHOWCASE_FIT,
  veilFromTraits,
  VETRINA_MATERIAL,
  zoningTexels,
  zoningTransmissionTexels,
  zoningUvs,
  zRange,
  type HighlightTarget,
  type MeshArrays,
  type Palette,
  type RenderProfile,
  type Rgb,
  type Veil,
} from './pure/index.ts';

/** [H] Camera: narrow field for little perspective distortion, slightly from above. */
const CAMERA_FOV_DEG = 28;
const CAMERA_ELEVATION = 0.32;
/** [H] Key light and warm rim light. */
const KEY_LIGHT_INTENSITY = 2.4;
const RIM_LIGHT_COLOR = 0xffe9c8;
const EDGE_COLOR = 0xfff4e0;
const ECONOMY_ENV_MAP_INTENSITY = 1.4;
const SHADOW_OPACITY = 0.38;
const SHADOW_RADIUS = 8;

interface Disposable {
  dispose(): void;
}

export interface ShowcaseScene {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Rotated about the world vertical axis by the turntable. */
  turntable: Group;
  /**
   * I-13b (ADR-0028): shows the overlay of one trait, or none. A target whose
   * element does not exist has no overlay: nothing lights up.
   */
  setHighlight(target: HighlightTarget | null): void;
  /** Releases every geometry, material, texture and render target created here. */
  dispose(): void;
}

const color = (rgb: Rgb): Color => new Color().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);

function stripeTexture(texels: Uint8Array): DataTexture {
  const texture = new DataTexture(texels, texels.length / 4, 1, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function backgroundGlowTexture(): DataTexture {
  const texture = new DataTexture(glowTexels(GLOW_SIZE), GLOW_SIZE, GLOW_SIZE, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function bodyGeometry(arrays: MeshArrays, range: readonly [number, number]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  // Face normals from planes[faceOfTriangle] (contract CrystalBody), never computeVertexNormals().
  geometry.setAttribute('normal', new BufferAttribute(arrays.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(zoningUvs(arrays, range), 2));
  for (const group of arrays.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  return geometry;
}

function crystalMaterial(
  profile: RenderProfile,
  palette: Palette,
  roughness: number,
  secondary: boolean,
  veil: Veil,
  radius: number,
  scale: number,
  zoning: Texture,
  zoningT: Texture,
): Material {
  const surfaceColor = color(mixRgb([1, 1, 1], palette.body, VETRINA_MATERIAL.bodyColorMix));
  switch (profile) {
    case 'vetrina':
      return new MeshPhysicalMaterial({
        color: surfaceColor,
        map: zoning,
        // Zoning bands: milky stripes of lower transmission show the body colour (p6).
        transmissionMap: zoningT,
        roughness,
        metalness: 0,
        // Real frosting on veiled faces (p1, p2, p3): no glossy clearcoat over frosted faces.
        clearcoat: roughness > ROUGHNESS_POLISHED ? 0 : VETRINA_MATERIAL.clearcoat,
        clearcoatRoughness: VETRINA_MATERIAL.clearcoatRoughness,
        emissive: color(palette.body),
        emissiveIntensity: VETRINA_MATERIAL.emissiveIntensity,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        // Veiled p3: secondaries frosted and milky (less transmission), still present.
        transmission: VETRINA_MATERIAL.transmission * (secondary && veil.secondaryFrosted ? SECONDARY_VEILED_TRANSMISSION : 1),
        ior: VETRINA_MATERIAL.ior,
        dispersion: VETRINA_MATERIAL.dispersion,
        thickness: radius * VETRINA_MATERIAL.thicknessFactor,
        attenuationColor: color(palette.body),
        attenuationDistance: radius * scale * VETRINA_MATERIAL.attenuationFactor,
        specularIntensity: VETRINA_MATERIAL.specularIntensity,
        envMapIntensity: VETRINA_MATERIAL.envMapIntensity,
        side: FrontSide,
      });
    case 'economy':
      return new MeshStandardMaterial({
        color: surfaceColor,
        map: zoning,
        roughness,
        metalness: 0,
        emissive: color(palette.body),
        emissiveIntensity: VETRINA_MATERIAL.emissiveIntensity,
        envMapIntensity: ECONOMY_ENV_MAP_INTENSITY,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        transparent: true,
        opacity: secondary && veil.secondaryFrosted ? SECONDARY_VEILED_OPACITY : ECONOMY_OPACITY,
        depthWrite: false,
        side: FrontSide,
      });
  }
}

/** Phantom: outline of a scaled copy of the primary (contract Inclusion 'phantom'). */
function phantomOutline(primary: CrystalBody): BufferGeometry {
  const edges = featureEdges(primary);
  const positions = new Float32Array(edges.length * 6);
  edges.forEach((edge, i) => {
    for (let c = 0; c < 3; c++) {
      positions[i * 6 + c] = (primary.positions[edge.a * 3 + c] ?? 0) / POSITION_UNITS_PER_LENGTH;
      positions[i * 6 + 3 + c] = (primary.positions[edge.b * 3 + c] ?? 0) / POSITION_UNITS_PER_LENGTH;
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

export function buildShowcaseScene(geometry: CrystalGeometry, profile: RenderProfile, renderer: WebGLRenderer, fixedScale = false): ShowcaseScene {
  const disposables: Disposable[] = [];
  const own = <T extends Disposable>(d: T): T => {
    disposables.push(d);
    return d;
  };
  checkBudget(geometry);
  const primary = geometry.bodies[0];
  if (primary === undefined) throw new RenderInputError('MALFORMED_BODY', 'geometry has no primary body');

  // Validate and convert everything BEFORE creating GPU objects: a malformed
  // geometry throws a typed RenderInputError and leaves nothing to release.
  const veil = veilFromTraits(geometry.appearance.veiledTraits);
  const palette = paletteFor(geometry.appearance, veil);
  const scale = crystalScale(geometry, fixedScale ? null : SHOWCASE_FIT);
  const range = zRange(primary);
  const bodyArrays = geometry.bodies.map((body) => bodyToMeshArrays(body));
  const needles = needleMatrices(geometry.inclusions, veil.inclusionsBlurred ? NEEDLE_RADIUS_FACTOR_VEILED : 1);
  const phantoms = phantomMatrices(geometry.inclusions);
  const scene = new Scene();
  scene.background = own(backgroundGlowTexture());

  // Procedural environment, no HDR file (ADR-0012).
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget: WebGLRenderTarget = own(pmrem.fromScene(room, 0.04));
  // RoomEnvironment.dispose() in 0.186.1 frees geometries and materials but
  // not the instance-matrix buffer of its InstancedMesh (measured in I-11).
  room.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose();
  });
  room.dispose();
  pmrem.dispose();
  scene.environment = envTarget.texture;

  // Crystal axis c (z in the contract) is the world vertical (y).
  const turntable = new Group();
  const crystal = new Group();
  crystal.rotation.x = -Math.PI / 2;
  crystal.scale.setScalar(scale);
  turntable.add(crystal);
  scene.add(turntable);

  const zoning = own(stripeTexture(zoningTexels(geometry.appearance.zoningBands, veil)));
  const zoningT = profile === 'vetrina' ? own(stripeTexture(zoningTransmissionTexels(geometry.appearance.zoningBands, veil))) : zoning;
  const edgeMaterials = new Map<number, readonly [LineBasicMaterial, LineBasicMaterial]>();
  const edgeMaterialsFor = (factor: number): readonly [LineBasicMaterial, LineBasicMaterial] => {
    let pair = edgeMaterials.get(factor);
    if (pair === undefined) {
      pair = [
        own(new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_FRONT_OPACITY * factor, depthTest: true, depthWrite: false })),
        own(new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_THROUGH_OPACITY * factor, depthTest: false, depthWrite: false })),
      ];
      edgeMaterials.set(factor, pair);
    }
    return pair;
  };
  const materials = new Map<string, Material>();
  const materialFor = (body: CrystalBody, secondary: boolean): Material[] =>
    FACE_CLASSES.map((faceClass) => {
      const roughness = roughnessFor(faceClass, secondary, veil);
      // Thickness and attenuation scale with each body: the radius is part of the key.
      const radius = boundingRadius(body);
      const key = `${String(secondary)}:${String(roughness)}:${String(radius)}`;
      let material = materials.get(key);
      if (material === undefined) {
        material = own(crystalMaterial(profile, palette, roughness, secondary, veil, radius, scale, zoning, zoningT));
        materials.set(key, material);
      }
      return material;
    });

  // I-13b: one overlay group per highlight target, hidden until a legend row asks for it.
  const glow = own(
    new MeshBasicMaterial({
      color: color(HIGHLIGHT_COLOR),
      transparent: true,
      opacity: HIGHLIGHT_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
      side: FrontSide,
    }),
  );
  const hidden = own(new MeshBasicMaterial({ visible: false }));
  const glowLine = own(new LineBasicMaterial({ color: color(HIGHLIGHT_COLOR), toneMapped: false }));
  const overlays = new Map<HighlightTarget, Group>(HIGHLIGHT_TARGETS.map((t) => [t, new Group()]));
  for (const g of overlays.values()) {
    g.visible = false;
    g.renderOrder = 10;
    crystal.add(g);
  }
  const overlay = (t: HighlightTarget): Group => overlays.get(t) ?? new Group();

  let minZ = range[0];
  geometry.bodies.forEach((body, i) => {
    const secondary = body.kind === 'secondary';
    const arrays = bodyArrays[i];
    if (arrays === undefined) return;
    const shape = own(bodyGeometry(arrays, range));
    const mesh = new Mesh(shape, materialFor(body, secondary));
    mesh.castShadow = profile === 'vetrina';
    crystal.add(mesh);
    minZ = Math.min(minZ, zRange(body)[0]);
    // The face groups of bodyToMeshArrays follow FACE_CLASSES: prism, termination.
    overlay('prism').add(new Mesh(shape, FACE_CLASSES.map((c) => (c === 'prism' ? glow : hidden))));
    overlay('termination').add(new Mesh(shape, FACE_CLASSES.map((c) => (c === 'termination' ? glow : hidden))));
    if (secondary) overlay('secondary').add(new Mesh(shape, glow));
    const edgeGeo = own(phantomOutline(body));
    const [frontEdgeMat, throughEdgeMat] = edgeMaterialsFor(secondary && veil.secondaryFrosted ? 0.5 : 1);
    for (const mat of [throughEdgeMat, frontEdgeMat]) {
      const lines = new LineSegments(edgeGeo, mat);
      lines.renderOrder = 5;
      crystal.add(lines);
    }
  });

  // Needles: opaque instanced cylinders (unit cylinder along z, contract Inclusion 'needle').
  const needleCount = needles.length / 16;
  if (needleCount > 0) {
    const cylinder = own(new CylinderGeometry(1, 1, 1, 10, 1).rotateX(Math.PI / 2));
    const material = own(new MeshStandardMaterial({ color: color(palette.inclusion), roughness: 0.35, metalness: 0.1 }));
    const instanced = own(new InstancedMesh(cylinder, material, needleCount));
    instanced.instanceMatrix.array.set(needles);
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    crystal.add(instanced);
    const lit = own(new InstancedMesh(cylinder, glow, needleCount));
    lit.instanceMatrix.array.set(needles);
    lit.instanceMatrix.needsUpdate = true;
    lit.computeBoundingSphere();
    overlay('inclusions').add(lit);
  }

  // Phantoms: opaque outlines of a scaled copy of the primary.
  if (phantoms.length > 0) {
    const outline = own(phantomOutline(primary));
    const material = own(new LineBasicMaterial({ color: color(palette.phantom) }));
    for (const m of phantoms) {
      const line = new LineSegments(outline, material);
      line.matrixAutoUpdate = false;
      line.matrix.copy(new Matrix4().fromArray(m).transpose());
      crystal.add(line);
      const lit = new LineSegments(outline, glowLine);
      lit.matrixAutoUpdate = false;
      lit.matrix.copy(line.matrix);
      overlay('inclusions').add(lit);
    }
  }

  // Key light, warm rim light and soft contact shadow (vetrina only).
  const key = new DirectionalLight(0xffffff, KEY_LIGHT_INTENSITY);
  key.position.set(2.5, 6, 3.5);
  scene.add(key);
  const rim = new DirectionalLight(RIM_LIGHT_COLOR, RIM_LIGHT_INTENSITY);
  rim.position.set(-3.5, 3, -4.5);
  scene.add(rim);
  if (profile === 'vetrina') {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = SHADOW_RADIUS;
    key.shadow.bias = -0.0005;
    const cam = key.shadow.camera;
    cam.left = -FRAMING_RADIUS;
    cam.right = FRAMING_RADIUS;
    cam.top = FRAMING_RADIUS;
    cam.bottom = -FRAMING_RADIUS;
    cam.near = 0.5;
    cam.far = 20;
    const floor = new Mesh(own(new PlaneGeometry(FRAMING_RADIUS * 4, FRAMING_RADIUS * 4)), own(new ShadowMaterial({ opacity: SHADOW_OPACITY })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = minZ * scale - 0.002;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // Framing camera: FRAMING_RADIUS matches fixedScale = true (or the scaled single showcase).
  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 100);
  const distance = FRAMING_RADIUS / Math.sin((CAMERA_FOV_DEG * Math.PI) / 360);
  camera.position.set(0, distance * CAMERA_ELEVATION, distance);
  camera.lookAt(0, 0, 0);

  return {
    scene,
    camera,
    turntable,
    setHighlight(target) {
      for (const [t, g] of overlays) g.visible = t === target && g.children.length > 0;
    },
    dispose() {
      // Shared textures Three injects into our materials' uniforms (in 0.186.1
      // the DFG LUT, a module singleton). Every renderer that uploads one adds
      // a 'dispose' listener to it, which keeps that renderer reachable after
      // its own dispose(): measured in I-11 as linear JS heap growth per cycle.
      const shared = new Set<Texture>();
      for (const material of materials.values()) {
        const uniforms = (renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> }).uniforms;
        for (const uniform of Object.values(uniforms ?? {})) {
          const value = uniform.value;
          if (value instanceof DataTexture && value !== zoning && value !== zoningT) shared.add(value);
        }
      }
      key.shadow.dispose();
      for (const d of disposables.splice(0)) d.dispose();
      // Frees this context's copy and drops the listeners; the texture stays usable (re-uploaded on next use).
      for (const texture of shared) texture.dispose();
      scene.clear();
      scene.background = null;
      scene.environment = null;
    },
  };
}
