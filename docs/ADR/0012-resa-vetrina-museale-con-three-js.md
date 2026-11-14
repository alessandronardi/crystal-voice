# ADR-0012: Resa «vetrina museale» con Three.js

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Il prodotto promette mineralogia digitale credibile e bella; la resa deve essere elegante ma sobria e senza asset remoti.

## Decisione

- `MeshPhysicalMaterial` con trasmissione, IOR, spessore, attenuazione; dispersione e tone mapping AgX o Neutral solo se presenti nella release Three.js fissata (`needs current-doc verification`).
- Ambiente procedurale (`RoomEnvironment` + PMREM), una luce chiave, ombra di contatto.
- Piatto girevole lento; camera ortografica per export; modalità economy.
- `dispose()` esplicito; gestione `webglcontextlost` con ripiego sulla tavola SVG.

**Note di taratura [H] (D-AP, D-AV, 2026-11-14, issue I-19):**
- **Fondale:** sostituito il fondo scuro neutro iniziale con inchiostro caldo `#2b2620` (D-AP) e `DataTexture` 256×256 radiale verso il centro caldo con dithering ordinato Bayer 4×4 (`±0,5` LSB) in `packages/renderer-three/src/pure/look.ts` (D-AV).
- **Materiale «vetrina» (resa 1A) e veli:** `VETRINA_MATERIAL` con `bodyColorMix = 0,85`, `transmission = 0,9`, `ior = 1,57`, `dispersion = 0,25`, `thicknessFactor = 0,6`, `attenuationFactor = 0,9`, `envMapIntensity = 1,8`, `emissiveIntensity = 0,08`, fattore cromatico `1,55` (`CHROMA_FACTOR`), `clearcoat = 1` disattivato (`0`) quando `roughness > ROUGHNESS_POLISHED` affinché i tratti velati (`p1`, `p2`, `p3`) restino davvero satinati senza strato lucido; bande di zonatura sia su `map` sia su `transmissionMap` (`zoningTransmissionTexels`); spigoli `LineSegments` in due passate (interne `0,12` dietro `0,24`, dimezzate sui secondari velati) e `rim` light calda (`2,5`); profilo `economy` aggiornato con `emissive` ed `envMapIntensity` coerenti.
- **Scala adattiva e Confronto (I-15):** in vetrina singola `crystalScale` riempie `SHOWCASE_FIT = 0,8` di `FRAMING_RADIUS` adattando l'altezza dell'ombra (`minZ * scale - 0,002`); `RenderConfig.fixedScale?: boolean` preserva la scala fissa (`1`) obbligatoria per mettere due cristalli a confronto su dimensione reale in I-15.

## Conseguenze

Qualità visiva alta senza file esterni. Rischio prestazionale su GPU deboli, mitigato da economy.

## Alternative scartate

Path tracing (costo); materiali standard soli (resa piatta).

## Verifica

100 cicli senza crescita di memoria; screenshot di riferimento con tolleranza (I-11).

## Riferimenti

SPEC §10
