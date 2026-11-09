// Non-conforming on purpose: the vertex path importing code it cannot vouch for (ADR-0010).
import { sinTable } from '../trig.ts'; // ✗
import { anything } from '../../src/appearance.ts'; // ✗
import { extract } from '@voicecrystal/dsp-core'; // ✗
import up from '..'; // ✗
import upSlash from '../'; // ✗
import dotUp from './../trig.ts'; // ✗
import nested from './a/../../trig.ts'; // ✗
import viaAllowed from '../trig-table.ts/../trig.ts'; // ✗
// Type-only imports are rejected too: shared types live in @voicecrystal/contracts.
import type { Hidden } from '../types.ts'; // ✗
import { table } from '../trig-table.ts';
export const lazy: unknown = import('../trig.ts'); // ✗
import type { CrystalSeed } from '@voicecrystal/contracts';
import { solve3x3 } from './linear.ts';
export const all: unknown[] = [sinTable, anything, extract, solve3x3, up, upSlash, dotUp, nested, viaAllowed, table];
export type H = Hidden;
export type Seed = CrystalSeed;
