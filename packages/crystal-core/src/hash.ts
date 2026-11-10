// geometryHash (SPEC §10): SHA-256 of a canonical byte serialization of the
// quantized geometry. Only integers enter the hash: plane definitions (floats)
// and appearance stay out.
//
// Layout, all big-endian:
//   "VCGH1" | len(version) u8 | version ASCII | bodyCount u32
//   per body: kind u8 (0 primary, 1 secondary) | V u32 | T u32 |
//             positions i32×3V | indices u32×3T | faceOfTriangle u16×T
//   inclusionCount u32 | per inclusion: kind u8 (0 needle, 1 phantom) | transform i32×16

import type { CrystalBody, Inclusion } from '@voicecrystal/contracts';
import { asciiBytes, sha256, toHex } from './geometry/index.ts';

export function canonicalGeometryBytes(version: string, bodies: readonly CrystalBody[], inclusions: readonly Inclusion[]): Uint8Array {
  const versionBytes = asciiBytes(version);
  if (versionBytes.length > 255) throw new RangeError('geometryVersion longer than 255 bytes');
  let size = 5 + 1 + versionBytes.length + 4 + 4 + inclusions.length * (1 + 64);
  for (const b of bodies) size += 1 + 4 + 4 + b.positions.length * 4 + b.indices.length * 4 + b.faceOfTriangle.length * 2;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(asciiBytes('VCGH1'), o);
  o += 5;
  view.setUint8(o, versionBytes.length);
  o += 1;
  out.set(versionBytes, o);
  o += versionBytes.length;
  view.setUint32(o, bodies.length, false);
  o += 4;
  for (const b of bodies) {
    view.setUint8(o, b.kind === 'primary' ? 0 : 1);
    o += 1;
    view.setUint32(o, b.positions.length / 3, false);
    o += 4;
    view.setUint32(o, b.faceOfTriangle.length, false);
    o += 4;
    for (const v of b.positions) {
      view.setInt32(o, v, false);
      o += 4;
    }
    for (const v of b.indices) {
      view.setUint32(o, v, false);
      o += 4;
    }
    for (const v of b.faceOfTriangle) {
      view.setUint16(o, v, false);
      o += 2;
    }
  }
  view.setUint32(o, inclusions.length, false);
  o += 4;
  for (const inc of inclusions) {
    view.setUint8(o, inc.kind === 'needle' ? 0 : 1);
    o += 1;
    for (let i = 0; i < 16; i++) {
      view.setInt32(o, inc.transform[i] ?? 0, false);
      o += 4;
    }
  }
  return out;
}

export function geometryHash(version: string, bodies: readonly CrystalBody[], inclusions: readonly Inclusion[]): string {
  return toHex(sha256(canonicalGeometryBytes(version, bodies, inclusions)));
}
