// Italian strings of the canonical plate: the single table for renderer-svg
// (AGENTS.md §8: UI strings centralized, never inline). They are part of the
// byte-identical output: changing any of them requires a new
// PLATE_RENDERER_VERSION and new golden plates.

import type { PlatePreset } from '@voicecrystal/contracts';

export const PLATE_STRINGS = Object.freeze({
  presets: Object.freeze({
    clinographic: 'vista clinografica',
    front: 'vista frontale',
    top: 'vista dall’alto',
  } satisfies Record<PlatePreset, string>),
  desc: (p: { renderer: string; preset: PlatePreset; visible: number; hidden: number; geometryVersion: string; hash16: string }): string =>
    `Tavola cristallografica ${p.renderer}: disegno a linee del corpo primario, ${PLATE_STRINGS.presets[p.preset]}; ` +
    `${p.visible} spigoli visibili, ${p.hidden} nascosti tratteggiati. Geometria ${p.geometryVersion}, hash ${p.hash16}.`,
});
