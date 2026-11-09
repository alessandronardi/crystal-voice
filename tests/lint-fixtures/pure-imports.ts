// Non-conforming on purpose: forbidden imports in a pure package (R10).
import * as THREE from 'three'; // ✗
import { Mesh } from 'three/src/objects/Mesh.js'; // ✗
import { readFileSync } from 'node:fs'; // ✗
import { join } from 'path'; // ✗
import { createRequire } from 'module'; // ✗
import assert from 'assert'; // ✗
import { promises } from 'fs/promises'; // ✗
import { openVault } from '@voicecrystal/vault'; // ✗
import { start } from '../../../extension/src/background/service-worker.ts'; // ✗
import { isCrystalSeed } from '@voicecrystal/contracts';
export const all: unknown[] = [createRequire, assert, promises, THREE, Mesh, readFileSync, join, openVault, start, isCrystalSeed];
