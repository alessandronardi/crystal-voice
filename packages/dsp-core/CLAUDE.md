# packages/dsp-core — regole locali

Valgono `AGENTS.md` e `CLAUDE.md` della radice. Riferimenti: SPEC §7, §8, §15; ADR-0006, ADR-0008, ADR-0014; `docs/BENCHMARK_PROTOCOL.md`.

## Confini

- Libreria pura: input `Float32Array` PCM mono + `sampleRate`, output strutture tipizzate. Nessuna API `chrome.*`, DOM, `AudioContext`, timer.
- Il tempo si misura in campioni, mai con orologi.
- Deve girare identica in Node (test, benchmark) e nel DSP worker.

## Regole numeriche

- `null` significa «non misurabile». Mai convertirlo in 0; mai `NaN` o `Infinity` in uscita.
- Statistiche robuste: mediana, percentili, IQR. Definisci il metodo dei percentili una volta (interpolazione lineare, tipo 7) in `stats.ts` e usalo ovunque.
- Le formule dei sei descrittori sono quelle di SPEC §7.4. Ogni modifica a formula, finestra, soglia o VAD incrementa `extractorVersion`.
- Le soglie `[H]` stanno in un unico file di configurazione versionato, non sparse nel codice.
- Pitch: YIN con soglia di aperiodicità 0,15 e range dello stimatore 60–1100 Hz (ADR-0017); il «frame intonato» dei descrittori resta 60–500 Hz (SPEC §7.4). Testa esplicitamente gli errori d'ottava.
- Resampling a 16 kHz per il VAD con filtro anti-alias deterministico.

## Test obbligatori

- Fixture sintetiche da `pnpm fixtures`: toni, sweep, rumore, silenzio, clipping, controfase, voce sintetica con f0 noto, A+B, alternanza A/B, voce + musica, voce compressa.
- Invarianza: ±6 dB di guadagno, 44,1 contro 48 kHz → Δ ≤ 1 punto per parametro.
- Determinismo: stesso PCM → stesso seed, bit per bit.
- Rifiuto: silenzio, toni puri, rumore → nessun cristallo.
- Split-half: mai `CONVERGED` prima di 8 s; fixture A+B senza arresto a cavallo del cambio.

## Divieti

- Nessun audio reale nel repository (R16).
- Nessuna soglia «aggiustata» per far passare un test senza una misura registrata nel benchmark (R15).
