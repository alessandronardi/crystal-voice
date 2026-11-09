# ADR-0010: Determinismo: quantizzazione e trigonometria propria

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

ECMAScript lascia all'implementazione l'accuratezza di `Math.sin`, `cos`, `exp`, `pow` e simili: un aggiornamento del motore JS può cambiare gli ultimi bit e quindi `geometryHash` (VC-08).

## Decisione

- Nel percorso dei vertici solo `+ − × ÷` e `Math.sqrt` (corretta per IEEE 754).
- Normali dei piani non normalizzate; angoli da costanti esatte o tabella versionata.
- Vertici quantizzati a interi in unità 2⁻¹⁶ prima di triangolazione e hash.
- PRNG `xoshiro128**` per dominio, seedato da SHA-256 della serializzazione canonica.
- Regola ESLint che vieta le funzioni `Math` non ammesse in `crystal-core/src/geometry/`.

## Conseguenze

Hash stabile fra motori e versioni. Leggero vincolo sullo stile del codice geometrico.

## Alternative scartate

Accettare la variabilità e rigenerare (rompe l'archivio); WebAssembly con libm propria (più complesso).

## Verifica

1.000 seed dorati con hash identici in Node, Chrome, Firefox (I-10).

## Riferimenti

SPEC §10
