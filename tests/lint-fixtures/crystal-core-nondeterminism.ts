// Non-conforming on purpose: randomness, clocks and mutable module state anywhere in crystal-core (R11).
export const r: number = Math.random(); // ✗
export const now: number = Date.now(); // ✗
export const bytes: unknown = crypto.getRandomValues(new Uint8Array(4)); // ✗
let counter = 0; // ✗
export let exported = 1; // ✗
const M = Math; // ✗
export const viaAlias: number = M.random();
const c = crypto; // ✗
export const viaCryptoAlias: unknown = c.getRandomValues(new Uint8Array(4));
export const viaBracket: number = Math['random'](); // ✗
export const digest: unknown = crypto.subtle;
export function next(): number {
  counter += 1;
  exported += 1;
  return counter + Math.sin(1); // Math.sin is allowed outside geometry/ (appearance)
}
