# ADR-0006: Normalizzazione per quantili e seed interi

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Con ancoraggi lineari i seed si addensano al centro e le collezioni sembrano tutte uguali; i float arrotondati a 0,01 hanno ambiguità di arrotondamento.

## Decisione

- `p_i = 100 · F_i(x_i)`, con `F_i` funzione di ripartizione empirica tabulata in 101 percentili per `mappingVersion`.
- Il seed persistito è una tupla di sei interi in [0, 10000], arrotondamento half-even.
- Prima di G1: `mapping-0-experimental` lineare fra ancoraggi provvisori, marcata in UI.

## Conseguenze

`p_i` ha significato diretto («più alto del N% delle voci di riferimento»); lo spazio delle forme è usato tutto. Dipendenza dalla qualità del dataset di calibrazione.

## Alternative scartate

Ancoraggi lineari (v0.2); z-score (non limitato, interpretazione meno immediata).

## Verifica

Monotonia delle tabelle; distribuzione dei seed ≈ uniforme sul set di valutazione (I-09).

## Riferimenti

SPEC §7.5
