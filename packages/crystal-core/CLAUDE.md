# packages/crystal-core — regole locali

Valgono `AGENTS.md` e `CLAUDE.md` della radice. Riferimenti: SPEC §10; ADR-0005, ADR-0010, ADR-0013, ADR-0014.

## Cosa fa

`generateCrystalGeometry(seed, confidence, geometryVersion)` → `CrystalGeometry`. Funzione pura, senza Three.js, senza DOM.

## Costruzione (ADR-0005)

- Ogni corpo è un'intersezione di semispazi `n·x ≤ d`. Algoritmo consigliato: enumerazione dei vertici come intersezioni di terne di piani, filtro dei vertici che rispettano tutti i vincoli, deduplica su griglia, poi faccia per faccia ordinamento angolare dei vertici e triangolazione a ventaglio. Con 30 o meno piani il costo è trascurabile e il codice resta verificabile.
- Solo forme cristallografiche ammesse: prismi trigonale, ditrigonale, esagonale, diesagonale; piramidi, romboedri, pinacoide. Assi 2, 3, 4, 6.
- Le facce emergono crescendo da dimensione zero: nessuna `floor`/`round` su un parametro che decida la presenza di una faccia.
- I cristalli secondari compaiono con dimensione proporzionale al parametro, partendo da 0.
- `p5_brightness` e `p6_rhythm` vanno in `appearance`, fuori dall'hash.

## Determinismo (ADR-0010)

- PRNG `xoshiro128**`, stato dai primi 128 bit di SHA-256 della serializzazione canonica `(seed, geometryVersion, domainLabel)`; un PRNG per dominio.
- Nel percorso dei vertici: niente `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log/sqrt` non garantite. Le direzioni delle normali dei piani vengono da tabelle esatte (seni e coseni di multipli di 30° sono costanti algebriche note: 0, ±1/2, ±√3/2, ±1) o da `trig-table.ts` versionata.
- `Math.sqrt` è corretta all'ultimo bit per specifica IEEE 754 ed è ammessa; documentalo nel codice dove la usi.
- Le normali dei piani non devono essere normalizzate: per una faccia di terminazione usa `n = (cos θ_k, sin θ_k, c)` con `c` = ripidità dal parametro e `d` scalato di conseguenza. I vertici si ottengono risolvendo sistemi 3×3 con sole operazioni `+ − × ÷`, deterministiche in IEEE 754.
- Quantizza i vertici a interi (unità 2⁻¹⁶) **prima** di triangolare e di calcolare l'hash. Ordine canonico: vertici ordinati per (x, y, z), triangoli per indice minimo poi lessicografico.
- SHA-256 tramite implementazione inclusa nel pacchetto o `crypto.subtle` con adattatore; l'hash deve coincidere in Node, Chrome e Firefox.
- Cosa verifica il lint (`tooling/eslint/purity.js`) e cosa no: blocca `let`/`var` di modulo, `Date`, timer, `Math.random`, alias di `Math` e `crypto`, `import()` dinamico; in `geometry/` anche i membri `Math` non ammessi e ogni import con `..`. **Non** rileva lo stato mutabile dentro `const` (oggetti, `Map`, campi statici di classe): resta un punto di revisione.

## Test obbligatori

- Seed dorati (1.000) in `tests/fixtures/seeds/golden-<geometryVersion>.json`: hash identici in Node e nei browser (`pnpm test:golden:browsers`).
- Property test (fast-check): convessità, chiusura (V − E + F = 2), winding esterno coerente, coordinate finite, budget triangoli ≤ 4.000 [H].
- Continuità: Δ di 100 unità in un parametro → 1 − IoU delle silhouette ≤ 0,03 [H].
- Ogni cambio di output su un seed dorato richiede un nuovo `geometryVersion` e il mantenimento del generatore precedente (i record salvati devono riaprirsi identici).
