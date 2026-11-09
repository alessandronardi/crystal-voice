// Non-conforming on purpose: engine-dependent Math in the vertex path (ADR-0010).
export const a = (t: number): number => Math.sin(t); // ✗
export const b = (t: number): number => Math.cos(t) + Math.atan2(t, 1); // ✗
export const c = (t: number): number => Math.exp(t); // ✗
export const d = (t: number): number => Math.pow(t, 2); // ✗
export const e = (t: number): number => Math.log(t); // ✗
export const f = (t: number): number => t ** 2; // ✗
export const g: number = Date.now(); // ✗
export const h: unknown = crypto.subtle; // ✗
