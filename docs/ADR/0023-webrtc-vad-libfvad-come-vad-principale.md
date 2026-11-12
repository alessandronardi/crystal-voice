# ADR-0023: WebRTC VAD (libfvad, modo 3) come VAD principale; la musica non si delega al VAD

- **Stato:** Proposto
- **Data:** 2026-11-12
- **Decisori:** product owner

## Contesto

SPEC §7.2 [F] chiede un VAD locale a frame di 20 ms a 16 kHz, «preferibilmente un'implementazione WebRTC». Al G1 WebRTC VAD (libfvad) e Silero VAD vanno confrontati sulle stesse fixture, e la scelta va registrata con licenza, dimensione del bundle e falsi positivi su musica (VC-11). D-L ha già deciso che nel bundle entra solo libfvad, compilato dal progetto, e che Silero resta in Node come riferimento.

**Fatti misurati il 2026-11-12** (`pnpm bench:vad:silero`, commit `f4e0a51`; Node 26.13.0, AMD Ryzen 7 3700U, Windows 11; 35 fixture sintetiche, 402 s di audio, frame da 20 ms):

| Motore | FN voce | FN voce + musica | FP solo musica¹ | FP pause della voce² | FP toni, rumore, impulsi | ms per s di audio |
|---|---|---|---|---|---|---|
| libfvad modo 0 | 0,3% | 0,0% | 97,1% | 66,9% | 57,7% | 0,34 |
| libfvad modo 1 | 0,3% | 0,0% | 92,7% | 67,0% | 57,6% | 0,31 |
| libfvad modo 2 | 0,4% | 0,1% | 86,8% | 59,9% | 52,9% | 0,30 |
| **libfvad modo 3** | **0,8%** | **6,7%** | **79,4%** | **54,4%** | **48,5%** | **0,31** |
| pre-filtro RMS + banda (solo diagnostica) | 0,0% | 0,0% | 100,0% | 9,7% | 43,8% | 0,23 |
| Silero v6.2.3 (riferimento in Node) | 33,5% | 4,2% | 36,2% | 26,7% | 0,0% | 8,38 |

¹ Fixture `music-chords-v1..v3` più i frame senza voce delle `voice-music-*`. ² Comprende le brevi pause fra le sillabe, non solo quelle fra le frasi: la coda di decisione (hangover) di un VAD le copre per costruzione.

**Per fixture:**
- **libfvad:**
  - dà «voce» sul 100% dei frame di `music-chords-*`, `noise-white`, `noise-pink` e `tone-400hz`;
  - su `voice-a` arriva all'83% dei frame, contro il 31% di Silero;
  - rifiuta del tutto solo il silenzio.
- **Silero:**
  - dà 0% su musica sola, toni e rumore;
  - riconosce come voce solo il 2% di `voice-a-compressed-4to1`.

**Dimensione e licenza:**

| Motore | Dimensione | Licenza |
|---|---|---|
| libfvad | `fvad.wasm` da 28.424 byte (12.924 compressi gzip), senza glue JS | BSD-3-Clause, con il file `PATENTS` di WebRTC (concessione di brevetti) |
| Silero | `onnxruntime-web` da 14,8 a 29,5 MB, più il modello da 2,3 MB (D-L) | MIT |

**Proprietà verificate:**
- libfvad è a virgola fissa: decisioni identiche fra due istanze e dopo `reset` (test unit).
- Non dipende dalle funzioni di `Math` del motore JS (VC-24).
- La build è riproducibile in CI.

**Limite noto e dichiarato in D-L:** le voci delle fixture sono sintetiche (sorgente-filtro). Silero, addestrato su parlato reale, ne rifiuta un terzo, quindi su questi dati la sua colonna FN non dice nulla del parlato reale. Anche i falsi positivi di libfvad sulla musica sintetica (accordi sostenuti) vanno confermati su musica reale.

**Cosa smentisce:** l'attesa implicita che il VAD da solo tenga fuori la musica. Su queste fixture libfvad si comporta da rivelatore di attività sonora: separa il silenzio dal resto, non la voce dalla musica.

## Decisione

1. **libfvad è il VAD principale** (`primary: true`) nel bundle, con il modo 3 [H] (`FVAD_MODE` in `packages/dsp-core/src/config.ts`). Fra i quattro modi è quello con meno falsi positivi su musica e rumore, al prezzo di uno 0,8% di falsi negativi sulla voce.
2. **La musica e i toni non si delegano al VAD.** I-06 deve tenerli fuori senza contare sul VAD:
   - con le euristiche di SPEC §7.2 (altezza stabile, energia armonica fra le sillabe, `MIXED_AUDIO_UNCERTAIN`);
   - con i test di rifiuto (silenzio, toni e rumore senza cristallo; `packages/dsp-core/CLAUDE.md`).
   Un frame «voce» del VAD è condizione necessaria, non sufficiente.
3. **`VadEngine` resta sincrona e a 20 ms** (forma di I-05a). Silero non entra nel bundle e il suo adattatore asincrono resta nel bench (`tools/silero-reference/`).
4. **Riesame al G1** con il parlato e la musica reali di I-08: stessa tabella, stesso comando, stessi motori. Se i falsi positivi di libfvad sulla musica reale restano inaccettabili dopo le euristiche di I-06, portare Silero nel bundle è una nuova decisione del product owner: dimensione, interfaccia asincrona, CSP.

## Conseguenze

- **Positive:**
  - bundle piccolo;
  - nessuna dipendenza dalla `Math` del motore (utile per VC-24);
  - decisione binaria e onesta: `probability: null`, come vuole SPEC §7.2;
  - costo trascurabile, circa 3000 volte il tempo reale su questo portatile.
- **Negative:**
  - VC-11 resta aperto e pesa su I-06: le euristiche musicali diventano la difesa principale, non un rinforzo;
  - le pause brevi fra le sillabe vengono spesso chiamate «voce», quindi le misure per frame di I-06 non possono usare il VAD come confine preciso della sillaba.
- **Versioni:** nessuna adesso. Il VAD entrerà nell'estrattore in I-06: lì `extractorVersion` cambia, e la scelta del VAD e del modo ne fa parte.
- **Licenza:** `THIRD_PARTY/libfvad/LICENSE` e `PATENTS` vanno nel pacchetto distribuito quando il `.wasm` entra in `dist/` (I-06, I-16).
- **Rischio da verificare per primo in I-06:** il caricamento di `fvad.wasm` nel `dsp-worker` sotto la CSP attuale (`'wasm-unsafe-eval'` c'è già, ma non è provato con questo modulo).

## Alternative scartate

- **Silero nel bundle ora:**
  - sulla musica sintetica è molto migliore (FP 0% su musica sola);
  - costa da 15 a 30 MB, ha un'interfaccia asincrona e non si può valutare su voci sintetiche, che rifiuta per un terzo.
  Rinviato al G1 con dati reali (punto 4).
- **libfvad modo 0–2:** più falsi positivi su musica e rumore (dall'87% al 97%) per un guadagno di mezzo punto sui falsi negativi.
- **Il pre-filtro come VAD:** vietato da SPEC §7.2 [F], e comunque peggiore sulla musica (100%).
- **Rinviare tutta la scelta al G1:** lascerebbe I-06 senza VAD. libfvad è comunque la preferenza [F] della specifica e il riesame resta previsto.

## Verifica

- `tests/unit/vad-fvad.test.ts`:
  - hash del modulo uguale a quello registrato;
  - import ammessi solo i tre stub WASI, che lanciano un errore;
  - silenzio mai voce;
  - determinismo; nessuno stato condiviso fra istanze;
  - errori tipizzati senza alterare lo stato;
  - property test su frame finiti.
- **Job CI «libfvad WASM (reproducible build)»:** il modulo committato è identico byte per byte a una build nuova nell'immagine `emscripten/emsdk:6.0.13` fissata per digest.
- **`pnpm bench:vad`** (libfvad e pre-filtro, in CI e in locale) e **`pnpm bench:vad:silero`** (in locale, con `tools/silero-reference` installato): la tabella sopra. Righe in `docs/BENCHMARK_PROTOCOL.md` §7.

## Riferimenti

- **Specifica e rischi:** SPEC §7.2; VC-11, VC-24.
- **Backlog e decisioni:** `docs/BACKLOG.md` I-05b (D-L), I-06, I-08.
- **Sorgenti:** `dpirch/libfvad` al commit `532ab666c20d3cfda38bca63abbb0f152706c369`; `snakers4/silero-vad` al tag `v6.2.3`, modello `src/silero_vad/data/silero_vad.onnx` (SHA-256 `1a153a22…88e3`).
- **Codice:** `scripts/vad/build-fvad.sh`, `tests/benchmarks/vad-compare.ts`.
