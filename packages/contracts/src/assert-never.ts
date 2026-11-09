/** Exhaustiveness check for discriminated unions (AGENTS.md §9). */
export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${JSON.stringify(value)}`);
}
