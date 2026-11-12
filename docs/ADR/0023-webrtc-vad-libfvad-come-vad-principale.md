# ADR-0023: WebRTC VAD (libfvad, modo 2) come VAD principale; la musica non si delega al VAD

- **Stato:** Accettato (2026-11-12, dal product owner, modo 2 compreso, dopo il confronto di I-05b e la revisione avversariale). La clausola di `PATENTS` resta da accettare a parte, prima di `dist/`
- **Data:** 2026-11-12
- **Decisori:** product owner

## Contesto

SPEC §7.2 [F] chiede un VAD locale a frame di 20 ms a 16 kHz, «preferibilmente un'implementazione WebRTC». WebRTC VAD (libfvad) e Silero VAD vanno confrontati sulle stesse fixture, e la scelta va registrata con licenza, dimensione del bundle e falsi positivi su musica (VC-11). D-L ha già deciso che nel bundle entra solo libfvad, compilato dal progetto, e che Silero resta in Node come riferimento.

**Fatti misurati il 2026-11-12** con `pnpm bench:vad:silero`, dopo le correzioni della revisione avversariale.
- **Ambiente:** Node 26.13.0, AMD Ryzen 7 3700U, Windows 11.
- **Dati:** 35 fixture sintetiche, 402 s analizzati, frame da 20 ms.
- **Verità:** dalle tracce f0 delle fixture vocali, con una banda di guardia di ±3 frame attorno a ogni passaggio voce/pausa (nota ³).
- **Frame contati:** voce 867, voce con musica 771, musica sola 1800, musica nelle pause 1240, pause 1383, silenzio 250, toni e rumore 1850.

| Motore | FN voce | FN voce + musica | FP musica sola¹ | FP musica nelle pause² | FP pause | FP silenzio | FP toni, sweep, rumore, impulsi | ms per s di audio |
|---|---|---|---|---|---|---|---|---|
| libfvad modo 0 | 0,1% | 0,0% | 100% | 90,4% | 32,3% | 0% | 65,5% | 0,36 |
| libfvad modo 1 | 0,2% | 0,0% | 100% | 76,0% | 32,3% | 0% | 65,4% | 0,31 |
| **libfvad modo 2** | **0,5%** | **0,0%** | **100%** | **65,7%** | **23,9%** | **0%** | **60,1%** | **0,31** |
| libfvad modo 3 | 0,9% | 6,6% | 100% | 50,1% | 22,3% | 0% | 55,1% | 0,30 |
| pre-filtro RMS + banda (solo diagnostica) | 0,0% | 0,0% | 100% | 99,8% | 0,0% | 0% | 49,7% | 0,23 |
| Silero v6.2.3 (riferimento in Node, soglia grezza 0,5)⁴ | 35,4% | 3,6% | 0% | 28,1% | 7,2% | 0% | 0% | 9,30 |

¹ `music-chords-v1..v3`, nessuna voce nel file.

² I frame senza voce delle `voice-music-*`. La coda di decisione (hangover) dopo la voce conta qui.

³ La traccia è campionata ogni 10 ms. Il generatore marca come non sonori tratti che hanno energia udibile: la coda dei formanti (50 ms), metà del rilascio e metà dell'attacco. Senza la banda di guardia la colonna «pause» saliva al 54–67% per libfvad. I frame misti si escludono. Le famiglie `antiphase`, `a-then-b` e `alternating-ab` sono escluse dalle cifre aggregate (motivo in `tests/benchmarks/vad-metrics.ts`).

⁴ Silero decide finestra per finestra, senza l'isteresi ufficiale (`neg_threshold`, `min_silence`, `speech_pad`); libfvad ha l'hangover integrato. Il confronto non è alla pari: le colonne di FP favoriscono Silero, la colonna FN lo penalizza.

**Lettura dei dati:**
- **libfvad si comporta da rivelatore di attività sonora.** Distingue il silenzio da tutto il resto, non la voce dalla musica: dà «voce» sul 100% della musica sola in ogni modo, e sul 55–66% di toni e rumore.
- **Il modo cambia solo l'hangover vicino alla voce:** musica nelle pause dal 90% (modo 0) al 50% (modo 3).
- **Il modo 3 costa caro dove serve:** perde il 6,6% dei frame di voce sotto la musica, contro lo 0,0% del modo 2. Parlato con musica di sottofondo è il caso tipico di YouTube.
- **Silero non è valutabile su queste fixture:**
  - dà 0% su musica sola, toni e rumore;
  - ma scarta il 35% della voce sintetica (2% riconosciuto su `voice-a-compressed-4to1`), e passa al 3,6% di FN quando si aggiunge musica.
  Più che riconoscere la voce, sembra rifiutare ciò che è armonico e povero. Il limite era previsto da D-L.

**Dimensione e licenza:**

| Motore | Dimensione | Licenza |
|---|---|---|
| libfvad | `fvad.wasm` da 28.424 byte, 12.924 compressi gzip, senza glue JS | BSD-3-Clause, con il file `PATENTS` di WebRTC: concessione di brevetti con clausola di revoca difensiva. Il modulo contiene anche parti della libc di Emscripten (musl, MIT), dlmalloc e compiler-rt (Apache-2.0 con eccezione LLVM) |
| Silero | `onnxruntime-web` 1.31.1 da 14,8 a 29,5 MB, più il modello da 2,3 MB (D-L) | MIT |

**Proprietà verificate di libfvad:**
- **Determinismo:** decisioni identiche fra due istanze e dopo `reset` (test unit).
- **Build riproducibile:** due build CI nell'immagine fissata sono identiche byte per byte.
- **Indipendenza dalla `Math` del motore JS:** libfvad è a virgola fissa. Non lo è la catena a monte: il resampler usa `sin` (VC-24), e Chromium decodifica gli int16 positivi come n/32767 (BENCHMARK_PROTOCOL §7, I-18). «Decisioni identiche» vale quindi dentro un motore JS; fra Node e pannello va misurato in I-06.

**Limite noto (D-L):** voci e musica sono sintetiche. Le colonne vanno confermate su parlato e musica reali.

## Decisione

1. **libfvad è il VAD principale** (`primary: true`) nel bundle, con il modo 2 [H] (`FVAD_MODE` in `packages/dsp-core/src/config.ts`).
   - Nessun modo rifiuta la musica sola.
   - Il modo 2 non perde voce sotto la musica (0,0%), contro il 6,6% del modo 3.
   - Riduce l'hangover rispetto ai modi 0 e 1.
2. **La musica e i toni non si delegano al VAD.** I-06 deve tenerli fuori senza contare sul VAD:
   - con le euristiche di SPEC §7.2 (altezza stabile, energia armonica fra le sillabe, `MIXED_AUDIO_UNCERTAIN`);
   - con i test di rifiuto (silenzio, toni e rumore senza cristallo; `packages/dsp-core/CLAUDE.md`).
   Un frame «voce» del VAD è condizione necessaria, non sufficiente.
3. **`VadEngine` resta sincrona e a 20 ms** (forma di I-05a). Silero non entra nel bundle: il suo adattatore asincrono resta nel bench (`tools/silero-reference/`).
4. **Un solo modo d'ingresso al modulo:** `instantiateFvad` di `dsp-core`. Rifiuta import non dichiarati; gli stub WASI lanciano un errore; un errore interno rende il modulo inutilizzabile per tutti i motori. Anche il `dsp-worker` di I-06 deve passare da lì.
5. **Riesame al G1** con il parlato e la musica reali di I-08: stessa tabella, stesso comando. Va aggiunta una variante di Silero con l'isteresi ufficiale, o un hangover equivalente per entrambi. Se i falsi positivi di libfvad sulla musica reale restano inaccettabili dopo le euristiche di I-06, portare Silero nel bundle è una nuova decisione del product owner: dimensione, interfaccia asincrona, CSP.

## Conseguenze

- **Positive:**
  - bundle piccolo;
  - motore deterministico;
  - decisione binaria e onesta (`probability: null`, come vuole SPEC §7.2);
  - costo trascurabile: circa 3000 volte il tempo reale su questo portatile.
- **Negative:**
  - VC-11 resta aperto e pesa tutto su I-06: le euristiche musicali sono la difesa principale, non un rinforzo;
  - la coda di decisione chiama spesso «voce» le pause brevi, quindi I-06 non può usare il VAD come confine preciso della sillaba.
- **Versioni:** nessuna adesso. Il VAD entrerà nell'estrattore in I-06: lì `extractorVersion` cambia, e la scelta del VAD e del modo ne fa parte.
- **Licenza, prima che `fvad.wasm` entri in `dist/` (I-06, I-16):**
  - accettare esplicitamente la clausola di `PATENTS`;
  - aggiungere a `THIRD_PARTY/` le note di musl, dlmalloc e compiler-rt;
  - distribuire `THIRD_PARTY/libfvad/LICENSE` e `PATENTS` nel pacchetto.
- **Rischi da verificare per primi in I-06:**
  - il caricamento di `fvad.wasm` nel `dsp-worker` sotto la CSP attuale (`'wasm-unsafe-eval'` c'è, ma non è provato con questo modulo);
  - un E2E che confronti le decisioni del VAD fra Node e pannello.
- **Controlli non automatici:**
  - il pacchetto `tools/silero-reference` è escluso da ESLint e il suo typecheck gira solo in locale;
  - `pnpm bench:vad` in CI si ferma solo se va in errore, non controlla soglie;
  - lo script Docker non è stato provato su Windows: il `.wasm` committato viene dalla CI.

## Alternative scartate

- **libfvad modo 3:** dimezza l'hangover sulla musica nelle pause (50% contro 66%), ma perde il 6,6% della voce sotto la musica e non guadagna nulla sulla musica sola.
- **libfvad modi 0 e 1:** stessa voce del modo 2, più hangover (dal 76% al 90% sulla musica nelle pause, 32% sulle pause).
- **Silero nel bundle ora:** rifiuta musica sola, toni e rumore. Però:
  - costa da 15 a 30 MB;
  - ha un'interfaccia asincrona;
  - non si può valutare su voci sintetiche, che scarta per un terzo.
  Rinviato al G1 con dati reali (punto 5).
- **Il pre-filtro come VAD:** vietato da SPEC §7.2 [F], e comunque peggiore sulla musica.
- **Rinviare tutta la scelta al G1:** lascerebbe I-06 senza VAD. libfvad è la preferenza [F] della specifica e il riesame resta previsto.

## Verifica

- **`tests/unit/vad-fvad.test.ts`:**
  - hash del modulo uguale a quello registrato;
  - import ammessi solo i tre stub WASI, e ogni stub lancia un errore;
  - un modulo con un import non dichiarato viene rifiutato;
  - silenzio mai voce;
  - determinismo e nessuno stato condiviso fra istanze;
  - errori tipizzati che non alterano lo stato;
  - un errore interno rende il modulo inutilizzabile;
  - property test su frame finiti.
- **`tests/unit/vad-metrics.test.ts`:** verità per frame, banda di guardia, categorie separate.
- **Job CI «libfvad WASM (reproducible build)»:** il modulo committato è identico byte per byte a una build nuova nell'immagine `emscripten/emsdk:6.0.13`, fissata per digest.
- **Bench:**
  - `pnpm bench:vad` per libfvad e pre-filtro, in CI e in locale;
  - `pnpm bench:vad:silero` in locale, con `tools/silero-reference` installato.
  Danno la tabella sopra; righe in `docs/BENCHMARK_PROTOCOL.md` §7.

## Riferimenti

- **Specifica e rischi:** SPEC §7.2; VC-11, VC-24.
- **Backlog e decisioni:** `docs/BACKLOG.md` I-05b (D-L), I-06, I-08.
- **Sorgenti:**
  - `dpirch/libfvad` al commit `532ab666c20d3cfda38bca63abbb0f152706c369`;
  - `snakers4/silero-vad` al tag `v6.2.3`, modello `src/silero_vad/data/silero_vad.onnx`, SHA-256 `1a153a22…88e3`.
- **Codice:** `scripts/vad/build-fvad.sh`, `tests/benchmarks/vad-compare.ts`, `tests/benchmarks/vad-metrics.ts`.
