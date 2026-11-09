# ADR-0013: Tavola cristallografica SVG come export canonico e fallback

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Il PNG WebGL non è identico fra GPU; serve un'immagine deterministica, stampabile e accessibile senza WebGL.

## Decisione

- Proiezione ortografica a linee del corpo primario; spigoli visibili se almeno una faccia adiacente guarda l'osservatore; nascosti tratteggiati.
- Coordinate arrotondate a 0,01 px; output identico byte per byte.
- Export canonico nel cartellino; fallback in tutte le schermate senza WebGL.

## Conseguenze

Un artefatto stabile e verificabile, nello stile degli atlanti mineralogici.

## Alternative scartate

PNG come export canonico (non deterministico).

## Verifica

SVG byte-identico per i seed dorati (I-12).

## Riferimenti

SPEC §10, §13
