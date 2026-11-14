// @voicecrystal/vault — IndexedDB crystal vault, schema migrations, and JSON backup/restore (SPEC §12).
export { VaultError, isQuotaExceededDomError, type VaultErrorCode } from './errors.ts';
export {
  runVaultMigrations,
  SETTING_NEXT_SPECIMEN,
  STORE_CRYSTALS,
  STORE_SETTINGS,
  STORE_THUMBNAILS,
  VAULT_DB_NAME,
  VAULT_DB_VERSION,
  VAULT_MIGRATIONS,
  type MigrationStep,
} from './migrations.ts';
export {
  deleteCrystal,
  estimateVaultStorage,
  exportVaultJson,
  hasAnySpeakerLabel,
  importVaultJson,
  listCrystals,
  openCrystal,
  openVaultDatabase,
  saveCrystal,
  vaultDatabaseExists,
  type SaveCrystalInput,
  type SavedCrystal,
  type VaultDeps,
  type VaultExportResult,
  type VaultImportResult,
  type VaultListItem,
  type VaultStorageEstimate,
} from './vault.ts';
export { verifyRecordGeometry, type VerifyGeometryDeps } from './verify.ts';
