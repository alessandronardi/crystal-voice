# ADR-0014: Confidenza per parametro e tratti velati

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Con audio YouTube reale (musica, riverbero, compressione) alcuni descrittori sono inaffidabili. Rifiutare il cristallo escluderebbe gran parte dei video; mostrarlo come certo sarebbe falso (VC-11, VC-13, D3).

## Decisione

- Ogni descrittore ha `confidence ∈ [0,1]`.
- Sotto 0,5 [H] il tratto è «velato» nella resa e dichiarato nel cartellino; il cristallo resta valido.
- `INSUFFICIENT_DATA` solo se un descrittore non è calcolabile o se più di due hanno confidenza < 0,5.

## Conseguenze

L'incertezza diventa visibile e parte dell'estetica.

## Alternative scartate

Rifiuto in blocco; nessuna indicazione.

## Verifica

Fixture voce + musica: tratti attesi velati, cartellino coerente (I-06, I-13).

## Riferimenti

SPEC §7.2, §10
