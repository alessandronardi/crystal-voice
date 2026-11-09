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

## Conseguenze

Qualità visiva alta senza file esterni. Rischio prestazionale su GPU deboli, mitigato da economy.

## Alternative scartate

Path tracing (costo); materiali standard soli (resa piatta).

## Verifica

100 cicli senza crescita di memoria; screenshot di riferimento con tolleranza (I-11).

## Riferimenti

SPEC §10
