# ADR-0020: La versione del renderer fa parte della promessa della tavola SVG

- **Stato:** Accettato
- **Data:** 2026-11-10
- **Decisori:** product owner (scelta in chat il 2026-11-10, rilievo M2 della revisione di I-12)

## Contesto

SPEC §10 (Portabilità) promette che la tavola SVG è identica byte per byte «a parità di `geometryVersion` e `PlateView`».

In I-12 l'output dipende anche da scelte del renderer che non stanno né nella geometria né nella vista: lo stile delle linee, il formato dei numeri, il testo di `<title>` e `<desc>`. Se un giorno cambia lo stile della tavola, la stessa geometria con la stessa vista darebbe un SVG diverso, contro la lettera della promessa. La revisione avversariale (M2) ha chiesto di decidere.

`PlateView` è definito per la prima volta in I-12 (`packages/contracts/src/plate.ts`), perché la SPEC lo nomina senza definirlo.

## Decisione

1. **Promessa:** a parità di `geometryVersion`, `PlateView` e `PLATE_RENDERER_VERSION`, l'SVG è identico byte per byte in Node, Chrome e Firefox.
2. **Versione:** `PLATE_RENDERER_VERSION` (oggi `plate-1`) sta in `packages/contracts`, compare nel `<desc>` di ogni tavola e nel file delle tavole dorate. Ogni modifica che cambia l'SVG di un seed dorato, testi compresi, richiede una nuova versione.
3. **Nessun renderer vecchio nel codice:** le tavole si rigenerano sempre con il renderer corrente, a partire dal record (seed e `geometryVersion`). Un SVG già esportato resta un file dell'utente e non viene riprodotto con la versione precedente.
4. **Congelamento:** `plate-1` si congela al G2 insieme allo schema di `habit-1`. Fino ad allora può cambiare rigenerando le tavole dorate.

## Conseguenze

**Positive**
- La promessa è verificabile: le tavole dorate fissano renderer e geometria insieme.
- Lo stile della tavola può evolvere senza toccare i record.

**Negative**
- Un utente che riesporta un esemplare dopo un cambio di renderer ottiene un file diverso da quello esportato prima. Il `<desc>` dice quale versione l'ha prodotto.
- Passando a `plate-2`, `scripts/golden/plates.ts --write` sostituisce le tavole dorate di `plate-1`, che non vengono conservate.

## Alternative scartate

- **Renderer vecchi riproducibili:** ogni versione del renderer resterebbe nel codice, come i generatori di geometria, e il record salverebbe la versione della tavola. Più codice e un campo nuovo nel record di I-14, per un beneficio che oggi non serve: la tavola è un export, non un dato.

## Verifica

- `tests/unit/renderer-svg/golden-plates.test.ts` e `tests/golden-browsers/plates.spec.ts`: 3.000 tavole identiche in Node e nei browser, con `renderer: 'plate-1'` nel file dorato.
- Test che il `<desc>` contenga la versione del renderer.

## Riferimenti

SPEC §10 (Portabilità, Tavola cristallografica SVG); ADR-0010; ADR-0013; revisione avversariale di I-12 (rilievo M2).
