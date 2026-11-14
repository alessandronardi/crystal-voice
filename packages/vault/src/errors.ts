// Typed errors for the local IndexedDB vault and export/import (SPEC §12, AGENTS.md §9).

export type VaultErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_VERSION'
  | 'MIGRATION_FAILED'
  | 'CORRUPT_RECORD'
  | 'GEOMETRY_HASH_MISMATCH'
  | 'BUDGET_EXCEEDED'
  | 'IMPORT_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_INPUT'
  | 'STORAGE_ERROR';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VaultError';
    this.code = code;
  }
}

export function isQuotaExceededDomError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? (error as { name?: unknown }).name : undefined;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
