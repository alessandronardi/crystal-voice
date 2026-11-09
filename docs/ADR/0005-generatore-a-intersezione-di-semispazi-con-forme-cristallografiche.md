# ADR-0005: Generatore a intersezione di semispazi con forme cristallografiche reali

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

La v0.2 sceglieva il numero di lati con `floor`: due clip della stessa voce cambiavano forma nel 20–61% dei casi in simulazione (VC-05). Prismi a 5, 7–12 lati non esistono nei cristalli periodici (VC-15). Le mesh procedurali con CSG rischiano superfici degeneri.

## Decisione

- Ogni corpo è l'intersezione dei semispazi dei suoi piani-faccia (principio di Wulff).
- `p1_pitch` percorre con continuità trigonale → ditrigonale → esagonale → esagonale smussato → diesagonale variando le distanze dei piani.
- Le facce emergono da dimensione zero; i secondari nascono da dimensione zero.
- Solo assi di simmetria 2, 3, 4, 6.

## Conseguenze

Mesh sempre convesse, chiuse, senza auto-intersezioni. Continuità verificabile con property test. Le costanti del cammino si tarano a occhio in fase 3 (G2).

## Alternative scartate

Prismi a n lati con bin (discontinuo); CSG di prismi e tagli (fragile); licenza artistica 3–12 lati (scartata da D2).

## Verifica

Property test di continuità, convessità, Eulero; seed dorati (I-10).

## Riferimenti

SPEC §10; revisione avversariale, Parte II B
