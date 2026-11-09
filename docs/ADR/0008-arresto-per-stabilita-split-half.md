# ADR-0008: Arresto per stabilità split-half

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Il criterio `c_t` della v0.2 confrontava medie cumulative: dopo 8 s ogni secondo nuovo pesa poco e la «convergenza» misura l'inerzia, non la rappresentatività (VC-07).

## Decisione

- La voce valida è divisa in blocchi di 1 s; ogni descrittore si stima sui blocchi pari e sui dispari.
- `s_t = max_i |a_i − b_i|`; stabile se `s_t ≤ τ` (τ = 6 punti [H]) per tre valutazioni consecutive, oltre agli 8 s minimi e alla copertura.

## Conseguenze

Costo computazionale doppio sulle stime robuste, trascurabile. Nessuna regola di arresto prevede il futuro: limite dichiarato.

## Alternative scartate

Bootstrap a blocchi (più costoso, stessa idea); mantenere `c_t` (difetto noto).

## Verifica

Fixture A+B; differenza fra seed all'arresto e seed a 18 s ≤ 5 punti nel 90% dei casi (G1).

## Riferimenti

SPEC §8
