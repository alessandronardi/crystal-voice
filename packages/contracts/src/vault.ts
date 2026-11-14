// Vault, export/import, and specimen card contracts (SPEC §12–13, ADR-0029).
// Pure module: zero DOM, chrome.*, Three.js, or IndexedDB references (R10, R17).

import { isGeometryVersion, type GeometryVersion } from './geometry.ts';
import { isCaptureExitReason, isQualitySummary, isRawMeasureTuple, type RawMeasureTuple } from './internal.ts';
import type { CaptureExitReason, QualitySummary } from './messages.ts';
import { isCrystalSeed, type CrystalSeed, type SeedConfidence } from './seed.ts';

export const VAULT_SCHEMA_VERSION = 1 as const;
export const VAULT_EXPORT_FORMAT = 'voicecrystal-export' as const;
export const VAULT_EXPORT_VERSION = 1 as const;
export const VAULT_EXPORT_FILENAME = 'voicecrystal-export-v1.json' as const;

export const VAULT_PNG_SIZE = 1024 as const;
export const VAULT_THUMBNAIL_SIZE = 256 as const;

export const MAX_VAULT_TITLE_LENGTH = 200 as const;
export const MAX_SPEAKER_LABEL_LENGTH = 120 as const;
export const MAX_TAG_LENGTH = 48 as const;
export const MAX_TAGS_PER_RECORD = 16 as const;
export const MAX_FILE_NAME_LENGTH = 255 as const;

/** SPEC §12 [H]: maximum size of an imported JSON backup (20 MB). */
export const MAX_VAULT_IMPORT_BYTES = 20 * 1024 * 1024;
/** SPEC §12 [H]: browser storage estimate warning threshold (200 MB). */
export const VAULT_STORAGE_WARNING_BYTES = 200 * 1024 * 1024;
/** SPEC §12 [H]: storage size target for 1,000 saved records (50 MB). */
export const VAULT_THOUSAND_RECORDS_TARGET_BYTES = 50 * 1024 * 1024;

/**
 * Source metadata persisted in the local vault and JSON exports (SPEC §9, ADR-0029).
 * Per G0-TECH-01, `tab` stores `{ kind: 'tab' }` only (no videoId, URL, or YouTube title);
 * `file` stores only normalized file name and time bounds, never file contents.
 */
export type VaultSource =
  | { kind: 'tab' }
  | { kind: 'mic' }
  | {
      kind: 'file';
      fileName: string;
      durationSeconds: number;
      offsetStartSeconds: number;
      offsetEndSeconds: number;
    };

export interface CrystalRecordV1 {
  id: string;
  specimenNumber: number;
  schemaVersion: 1;
  createdAt: string;
  title: string;
  speakerLabel: string | null;
  source: VaultSource;
  seed: CrystalSeed;
  confidence: SeedConfidence;
  rawMeasures: RawMeasureTuple;
  extractorVersion: string;
  mappingVersion: string;
  geometryVersion: GeometryVersion;
  comparatorVersion: string;
  captureExitReason: CaptureExitReason;
  quality: QualitySummary;
  geometryHash: string;
  tags: string[];
}

export interface VoiceCrystalExportV1 {
  format: typeof VAULT_EXPORT_FORMAT;
  version: typeof VAULT_EXPORT_VERSION;
  exportedAt: string;
  records: CrystalRecordV1[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.getOwnPropertyNames(obj);
  if (keys.length !== allowed.length) return false;
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.includes(key)) return false;
  }
  return true;
}

/**
 * Returns true if any object in the tree carries own `__proto__`, `constructor`,
 * or `prototype` keys (or exceeds max recursion depth), guarding JSON imports (R17).
 */
export function hasForbiddenKeys(value: unknown, maxDepth = 16): boolean {
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > maxDepth) return true;
    if (typeof node !== 'object' || node === null) return false;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (visit(item, depth + 1)) return true;
      }
      return false;
    }
    const obj = node as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (FORBIDDEN_KEYS.has(key)) return true;
      if (visit(obj[key], depth + 1)) return true;
    }
    return false;
  };
  return visit(value, 0);
}

export function normalizeVaultText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isSafeText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > maxLength) return false;
  if (!allowEmpty && value.trim().length === 0) return false;
  if (hasControlChars(value)) return false;
  if (value.includes('<') || value.includes('>')) return false;
  return true;
}

export function formatSpecimenCode(specimenNumber: number): string {
  const n = Number.isInteger(specimenNumber) && specimenNumber >= 1 ? specimenNumber : 1;
  return `VC-${String(n).padStart(4, '0')}`;
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_RE.test(value);
}

export function isIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_UTC_RE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || day < 1) return false;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isSeedConfidence(value: unknown): value is SeedConfidence {
  if (!Array.isArray(value) || value.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    const v: unknown = value[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

export function isVaultSource(value: unknown): value is VaultSource {
  if (!isPlainObject(value)) return false;
  const kind = value['kind'];
  if (kind === 'tab' || kind === 'mic') {
    return hasExactKeys(value, ['kind']);
  }
  if (kind === 'file') {
    if (!hasExactKeys(value, ['kind', 'fileName', 'durationSeconds', 'offsetStartSeconds', 'offsetEndSeconds'])) {
      return false;
    }
    const { fileName, durationSeconds, offsetStartSeconds, offsetEndSeconds } = value;
    if (!isSafeText(fileName, MAX_FILE_NAME_LENGTH, false)) return false;
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
    if (typeof offsetStartSeconds !== 'number' || !Number.isFinite(offsetStartSeconds) || offsetStartSeconds < 0) {
      return false;
    }
    if (typeof offsetEndSeconds !== 'number' || !Number.isFinite(offsetEndSeconds)) return false;
    return offsetEndSeconds >= offsetStartSeconds && offsetEndSeconds <= durationSeconds + 0.05;
  }
  return false;
}

const CRYSTAL_RECORD_V1_KEYS = [
  'id',
  'specimenNumber',
  'schemaVersion',
  'createdAt',
  'title',
  'speakerLabel',
  'source',
  'seed',
  'confidence',
  'rawMeasures',
  'extractorVersion',
  'mappingVersion',
  'geometryVersion',
  'comparatorVersion',
  'captureExitReason',
  'quality',
  'geometryHash',
  'tags',
] as const;

export function isCrystalRecordV1(value: unknown): value is CrystalRecordV1 {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, CRYSTAL_RECORD_V1_KEYS)) return false;
  if (hasForbiddenKeys(value)) return false;
  if (!isUuidV4(value['id'])) return false;
  const specimenNumber = value['specimenNumber'];
  if (typeof specimenNumber !== 'number' || !Number.isInteger(specimenNumber) || specimenNumber < 1) {
    return false;
  }
  if (value['schemaVersion'] !== VAULT_SCHEMA_VERSION) return false;
  if (!isIsoUtcTimestamp(value['createdAt'])) return false;
  if (!isSafeText(value['title'], MAX_VAULT_TITLE_LENGTH, true)) return false;
  const speakerLabel = value['speakerLabel'];
  if (speakerLabel !== null && !isSafeText(speakerLabel, MAX_SPEAKER_LABEL_LENGTH, false)) return false;
  if (!isVaultSource(value['source'])) return false;
  if (!isCrystalSeed(value['seed'])) return false;
  if (!isSeedConfidence(value['confidence'])) return false;
  if (!isRawMeasureTuple(value['rawMeasures'])) return false;
  if (!isSafeText(value['extractorVersion'], 64, false)) return false;
  if (!isSafeText(value['mappingVersion'], 64, false)) return false;
  if (!isGeometryVersion(value['geometryVersion'])) return false;
  if (!isSafeText(value['comparatorVersion'], 64, false)) return false;
  if (!isCaptureExitReason(value['captureExitReason'])) return false;
  if (!isQualitySummary(value['quality'])) return false;
  if (!isSha256Hex(value['geometryHash'])) return false;
  const tags = value['tags'];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS_PER_RECORD) return false;
  for (const tag of tags) {
    if (!isSafeText(tag, MAX_TAG_LENGTH, false)) return false;
  }
  return true;
}

export function isVoiceCrystalExportV1(value: unknown): value is VoiceCrystalExportV1 {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['format', 'version', 'exportedAt', 'records'])) return false;
  if (hasForbiddenKeys(value)) return false;
  if (value['format'] !== VAULT_EXPORT_FORMAT) return false;
  if (value['version'] !== VAULT_EXPORT_VERSION) return false;
  if (!isIsoUtcTimestamp(value['exportedAt'])) return false;
  const records = value['records'];
  if (!Array.isArray(records)) return false;
  for (const record of records) {
    if (!isCrystalRecordV1(record)) return false;
  }
  return true;
}
