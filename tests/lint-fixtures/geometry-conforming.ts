// Conforming: only + - * / and Math.sqrt (correctly rounded, IEEE 754), exact constants.
export function norm(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z) / 2 - 1;
}
export const SIN_30 = 1 / 2;
export const SIN_60 = Math.sqrt(3) / 2;
export const quantize = (v: number): number => Math.round(v * 65536);
export const halfTurn: number = Math.PI;
