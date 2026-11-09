# ADR-0007: Affinità presentata come percentile di vicinanza

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

`Affinity = 100·(1 − D)` vale in media circa 60% per seed uniformi indipendenti e circa 80% per seed gaussiani (simulazione, VC-06): l'utente legge somiglianza nel caso.

## Decisione

- Calcolo invariato: distanza euclidea pesata `D`.
- UI: «Più vicini del N% delle coppie di voci diverse di riferimento», con `N = 100·(1 − G(D))`.
- `G` è tabulata per `comparatorVersion`; prima di G1 deriva da seed uniformi ed è marcata sperimentale.
- `Affinity` e i sei contributi restano nei dettagli.

## Conseguenze

Numero interpretabile e onesto; richiede il dataset di riferimento per diventare definitivo.

## Alternative scartate

Riscalare `Affinity` con una soglia fissa (arbitraria); nascondere il numero (perde utilità del confronto).

## Verifica

Sul dataset di valutazione, percentile mediano per coppie di parlanti diversi ≈ 50 (I-15).

## Riferimenti

SPEC §11
