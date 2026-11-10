// Exact constants and small linear algebra for the vertex path (ADR-0010).
// Only + − × ÷ and Math.sqrt (correctly rounded by IEEE 754 / ECMAScript).

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

/** √3, correctly rounded (Math.sqrt is exact to the last bit by IEEE 754). */
export const SQRT3 = Math.sqrt(3);

/**
 * Unit directions at multiples of 30° in the basal plane, from exact values
 * cos/sin ∈ {0, ±1/2, ±√3/2, ±1}. Index k ↔ angle 30°·k.
 */
export const DIRECTIONS_30: readonly (readonly [number, number])[] = [
  [1, 0],
  [SQRT3 / 2, 0.5],
  [0.5, SQRT3 / 2],
  [0, 1],
  [-0.5, SQRT3 / 2],
  [-SQRT3 / 2, 0.5],
  [-1, 0],
  [-SQRT3 / 2, -0.5],
  [-0.5, -SQRT3 / 2],
  [0, -1],
  [0.5, -SQRT3 / 2],
  [SQRT3 / 2, -0.5],
];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Rotation matrix of the (not necessarily unit) quaternion (w, x, y, z):
 * R = M(q) / |q|². Rational in q, hence continuous and trigonometry-free.
 */
export function quaternionToMatrix(w: number, x: number, y: number, z: number): Mat3 {
  const n = w * w + x * x + y * y + z * z;
  return [
    [(w * w + x * x - y * y - z * z) / n, (2 * (x * y - w * z)) / n, (2 * (x * z + w * y)) / n],
    [(2 * (x * y + w * z)) / n, (w * w - x * x + y * y - z * z) / n, (2 * (y * z - w * x)) / n],
    [(2 * (x * z - w * y)) / n, (2 * (y * z + w * x)) / n, (w * w - x * x - y * y + z * z) / n],
  ];
}

export const mulMatVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
