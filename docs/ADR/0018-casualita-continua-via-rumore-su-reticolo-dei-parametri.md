# ADR-0018: Casualità continua nel generatore: rumore su un reticolo dei parametri geometrici

- **Stato:** Accettato
- **Data:** 2026-11-10
- **Decisori:** product owner (scelta in chat il 2026-11-10, piano di I-10)

**Aggiornamento dopo la taratura (2026-11-10, I-10):** `NOISE_CELL` = 5000 invece di 2000, e il dominio `orientation` resta riservato ma non è usato. Con 2000 e un orientamento globale casuale la misura di continuità dava 1 − IoU = 0,20 (`docs/BENCHMARK_PROTOCOL.md` §7). Ruotare tutto il cristallo sposta tutta la silhouette; l'orientamento di vista è compito del renderer.

## Contesto

SPEC §10 contiene due requisiti [F] che, letti insieme, sono incompatibili:

- **Determinismo (Δ16, ADR-0010):** PRNG `xoshiro128**` seedato dai primi 128 bit di SHA-256 della serializzazione canonica `(seed, geometryVersion, domainLabel)`.
- **Continuità:** due seed che differiscono di al più 100 unità in un solo parametro devono dare 1 − IoU delle silhouette ≤ 0,03 [H].

Se nel PRNG entra l'intero seed, cambiare un parametro anche di 1 unità cambia lo SHA-256 e quindi l'intera sequenza casuale. Posizioni e orientamenti dei cristalli secondari, inclusioni e orientamento globale salterebbero, e la proprietà di continuità fallirebbe per costruzione.

AGENTS.md §2 chiede di fermarsi davanti a un conflitto fra fonti. Il product owner ha scelto il rumore continuo fra tre opzioni presentate.

## Decisione

1. **Grandezze casuali come funzioni continue.** Ogni grandezza «casuale» della geometria è una funzione continua dei quattro parametri geometrici (p1…p4), non un'estrazione dal seed intero.
2. **Reticolo.** Lo spazio (p1, p2, p3, p4) in unità di seed ha un reticolo di passo `NOISE_CELL` [H]: 5000 unità (50 punti), cioè 3 nodi per asse e 81 in tutto. Il valore iniziale di 2000 non superava la continuità. Per ogni nodo, dominio e canale, il valore è il primo numero di un PRNG `xoshiro128**` seedato dai primi 128 bit di SHA-256 della serializzazione canonica `(nodo, geometryVersion, domainLabel)`. È la regola di SPEC §10 con il nodo del reticolo al posto del seed.
3. **Interpolazione.** Fra i 16 nodi della cella, multilineare con pesi smoothstep `3t² − 2t³`: solo `+ − × ÷`, quindi deterministica in IEEE 754 (ADR-0010). Il risultato è continuo, con derivata limitata.
4. **Domini separati:** `secondary` e `inclusions`; `orientation` è riservato e non usato in `habit-1`. Ogni dominio ha i propri canali; aggiungere un canale non perturba gli altri.
5. **p5 e p6** sono aspetto (fuori dall'hash) e non entrano nel rumore: la geometria e `geometryHash` non dipendono da loro.

## Conseguenze

**Positive**
- La continuità è verificabile per costruzione e misurabile con il property test.
- Ogni voce ha comunque una disposizione propria, che varia gradualmente nello spazio dei parametri.

**Negative**
- Due seed molto vicini hanno secondari e inclusioni quasi uguali: è voluto.
- Con 81 nodi la varietà fra voci diverse è limitata: i secondari stanno su posizioni base fisse, e il rumore ne varia solo soglia di nascita, altezza e inclinazione. È da valutare al G2.
- `NOISE_CELL` è un compromesso fra varietà (passo piccolo) e continuità (passo grande), da tarare con la misura di continuità (R15 per la soglia) e con la revisione estetica G2.
- Ogni geometria calcola al più 16 × (domini) SHA-256 su input brevi: costo trascurabile, da misurare.
- Cambiare `NOISE_CELL` o i canali cambia gli hash e richiede un nuovo `geometryVersion`.

## Alternative scartate

- **PRNG fisso per versione:** seed solo da `(geometryVersion, dominio)`. La casualità sarebbe una firma uguale per tutti i cristalli, con meno varietà.
- **Seed intero, continuità solo sul primario:** rispetta la lettera del PRNG ma richiede di indebolire il requisito di continuità, e secondari e inclusioni salterebbero a ogni variazione.

## Verifica

- Unit test del rumore: deterministico, continuo e limitato nella variazione per Δ piccoli dell'ingresso.
- Property test di continuità su 300 coppie in `pnpm test`, e su 10.000 coppie in `pnpm bench:continuity`, con il valore registrato in `docs/BENCHMARK_PROTOCOL.md` §7.
- Seed dorati: hash identici in Node, Chrome e Firefox.

## Riferimenti

SPEC §10 (Determinismo, Proprietà di continuità); ADR-0005; ADR-0010.
