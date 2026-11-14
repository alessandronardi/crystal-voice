# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni [SemVer](https://semver.org/lang/it/). Le versioni semantiche dei dati (`extractorVersion`, `mappingVersion`, `geometryVersion`, `comparatorVersion`, `schemaVersion`) si annotano accanto alla voce che le cambia.

## [Unreleased]

### Aggiunto
- G0: `LICENSE` (MIT) nella radice (prescrizione G0-ACT-02) e `PRIVACY.md` con il testo approvato in §5.3 della valutazione G0 (G0-DOC-03). G0-ACT-03 verificata: il `PATENTS` di libfvad è in `THIRD_PARTY/`, compiler-rt (LLVM) non ha un file `NOTICE` da includere.
- I-13a: le schermate del pannello (SPEC §13), stile «Gabinetto di mineralogia» (D-AJ). Non distribuibile prima che le prescrizioni di G0 siano completate.
  - **Macchina della vista** pura (SPEC §6.2): `HOME → LIVE → REVEALED | OUTCOME → HOME` in `extension/src/sidepanel/view-machine.ts`, con property test (mai un cristallo senza qualità accettata e 8 s di voce valida).
  - **Home:** le tre sorgenti, l'avviso «elaborazione locale e sperimentale» (prescrizione G0-DOC-01) e i link alle licenze nel pacchetto.
  - **Ascolto:** germe dal seme provvisorio, «in crescita, provvisorio», voce utile X / 18 s, «Interrompi».
  - **Rivelazione:** vetrina 3D di `renderer-three` (tavola SVG senza WebGL), cartellino, «Scarta», «Esporta tavola SVG»; «Salva» arriva con I-14.
  - **Esito:** dati insufficienti, interruzione, errore, con il motivo.
  - I controlli e le righe tecniche di prima stanno nella card «La tua voce» o in «Dettagli tecnici».
- I-13a: `CAPTURE_DIAG.provisionalSeed` e `STREAM_PROGRESS.provisionalSeed` (contratto interno): il seme dell'audio raccolto finora, solo durante l'ascolto e solo per il germe.
- I-13a: three.js nel pacchetto dell'estensione (D-AI), in un file proprio (`assets/three.js`, 542.604 byte), con eccezioni puntuali della guardia del bundle e la licenza MIT in `THIRD_PARTY/three/`.
- G0: decisione D-AH, valutazione di un agente IA di revisione legale accettata senza avvocato; G0 superato con prescrizioni (`docs/gates/G0-valutazione-2026-11-13.md`).
- ADR-0027 (accettato il 2026-11-13, D-AG): G0 obbligatorio prima della distribuzione, non dello sviluppo. Aggiornati `AGENTS.md` §3, `docs/GATES.md`, `docs/BACKLOG.md` e SPEC §3 (nota); domanda sul repository pubblico in `docs/LEGAL_G0_CHECKLIST.md`.
- `docs/gates/G0-fascicolo-legale.md`: fatti verificati e domande per il parere legale di G0 (non è un parere).
- I-07: arresto split-half (SPEC §8, ADR-0008; ADR-0026 accettato il 2026-11-13, D-AF).
  - **Regola:** `splitHalfAt` in `dsp-core` divide la voce valida in blocchi da 1 s, pari e dispari, con onset contati sul prefisso intero. `SplitHalfMonitor` (`extension/src/shared/split-half-rule.ts`) valuta un secondo di voce valida alla volta da 8 s, con τ = 6 punti e 3 valutazioni di fila. Un avviso «più voci» blocca l'arresto per il resto della sessione (nessuno può rispondere prima di I-13); un descrittore mancante o una metà incompleta bloccano la valutazione. Costanti in `stop-config.ts`, `STOP_RULE_VERSION = split-half-0`; `extractorVersion` e i seed non cambiano.
  - **Durante l'ascolto:** il `dsp-worker` dell'offscreen rianalizza l'audio raccolto a ogni secondo intero, con la stessa funzione del risultato finale (D-AD), una valutazione alla volta e in un task successivo, così salta all'ultimo secondo arrivato; manda `STREAM_PROGRESS`. La sessione usa la voce valida nei `TICK`, quindi `MAX_VALID_SPEECH` scatta a 18 s, e applica `SPLIT_HALF_STABLE` alla convergenza.
  - **Contratto interno:** `CAPTURE_DIAG.validSpeechMs` e `CAPTURE_DIAG.stability` (`CaptureStability`, `SplitHalfBlock`), con le guardie; `CaptureMessage` di SPEC §9 invariato.
  - **Pannello:** righe tecniche «Voce valida» e «Stabilità del campionamento».
  - **Misure:** `pnpm bench:descriptors` simula le sessioni secondo per secondo (`tests/benchmarks/stop-simulation.ts`). Con τ = 6 la voce sintetica lunga non converge e si ferma a 18 s di voce valida; τ resta 6 fino a G1 (D-AE).
- SPEC §8: nota che rimanda ad ADR-0026.
- Prove manuali M32–M34 (arresto con microfono, YouTube a una voce, YouTube a due voci).
- I-06b: libfvad e il seed nell'estensione.
  - **Bundle:** `fvad.wasm` e i testi di licenza (libfvad, `PATENTS`, musl, compiler-rt, dlmalloc, Emscripten) in `dist/extension/`, ammessi dalla guardia solo con il loro SHA-256. Il `dsp-worker` scarica il modulo dalla propria origine, ne controlla l'hash e lo istanzia con `instantiateFvad` (CSP invariata).
  - **File locale:** il pannello calcola descrittori, avvisi e seed di `mapping-0` e li mostra in righe tecniche «sperimentali»; `pcm-analysis-1`.
  - **Scheda e microfono:** il worklet inoltra l'audio degli stati di ascolto a un `dsp-worker` dell'offscreen, che lo tiene in RAM e lo analizza in `FINALIZING` con la stessa funzione dei file (ADR-0025); il risultato arriva al pannello in `CAPTURE_DIAG.analysis` (contratto interno, D-Y). Fino a I-07 il seed arriva solo dopo 45 s di ascolto.
  - **Licenze:** il job CI `fvad-wasm` copia le note dall'immagine Emscripten fissata e le confronta byte per byte con `THIRD_PARTY/` (D-X).
  - **Fine sessione:** all'ingresso in `FINALIZING` la cattura si chiude subito (R8, rilievo C-1); navigazione e chiusura della scheda durante l'analisi non scartano il risultato, «Interrompi» sì (D-Z). Anche i file chiedono 8 s di voce valida (D-AA).
- ADR-0025 (accettato il 2026-11-13): analisi di scheda e microfono a fine sessione sull'audio tenuto in RAM.
- ADR-0011: accettati i due archi da `FINALIZING` dell'emendamento (D-Z).
- Prove manuali M29–M31 (file di voce, YouTube con parlato, microfono).
- I-06a: estrattore `extractor-0-experimental` in `dsp-core` (solo Node).
  - **Frame acustici** (SPEC §7.3): FFT radix-2, centroide, flatness e flusso in 300–4000 Hz, decisione di libfvad modo 2, livello normalizzato per tutto il clip (D-V).
  - **Sei descrittori** di SPEC §7.4, con p3 e p6 sui frame intonati (D-V); `null` sotto i minimi, mai 0.
  - **Euristiche:** musica (altezza ferma, energia armonica senza altezza unica, flusso periodico) → `MIXED_AUDIO_UNCERTAIN`; più voci (bimodalità con distanza fra gruppi, salti del centroide) → `MULTI_SPEAKER_SUSPECTED` (D-T).
  - **Confidenza** per parametro pesata dalla quota di musica (D-U), velo e `INSUFFICIENT_DATA` come ADR-0014, `qualitySummary` per SPEC §9.
  - **Versione:** `extractorVersion = extractor-0-experimental` solo con il VAD canonico; un test fissa l'impronta di tutte le costanti.
- I-06a: `packages/calibration` con `mapping-0-experimental.json` (ancoraggi di SPEC §7.5, generati da `scripts/calibration/build-mapping-0.ts`), mappa per quantili e seed interi half-even; `mappingVersion = mapping-0-experimental`.
- I-06a: `pnpm bench:descriptors` (anche in CI); misure in `docs/BENCHMARK_PROTOCOL.md` §7, solo su fixture sintetiche e in-sample. Lacuna nota dalla revisione avversariale: toni a impulsi e melodie a note brevi danno un cristallo senza avvisi, tracciati come test attesi in errore.
- ADR-0024 (accettato il 2026-11-12): parametri di `extractor-0`, normalizzazione di livello, euristiche misurate.
- I-05b: WebRTC VAD.
  - **Build:** libfvad (`dpirch/libfvad` al commit `532ab66`, BSD-3-Clause con `PATENTS`) compilato in WASM dal progetto: `scripts/vad/build-fvad.sh` nell'immagine `emscripten/emsdk:6.0.13`, fissata per digest. Il file `packages/dsp-core/wasm/fvad.wasm` (28.424 B) è committato con il suo SHA-256; il job CI «libfvad WASM (reproducible build)» lo ricostruisce e lo confronta byte per byte.
  - **Motore:** `createWebRtcVad` in `dsp-core`, dietro `VadEngine` (binario, `probability: null`). Si istanzia solo con `instantiateFvad`: import non dichiarati rifiutati, stub WASI che lanciano un errore, modulo inutilizzabile dopo un errore interno. `FVAD_MODE` = 2 [H].
- I-05b: confronto dei VAD.
  - **Comandi:** `pnpm bench:vad` (anche in CI) e `pnpm bench:vad:silero`.
  - **Riferimento Silero:** Silero VAD v6.2.3, con `onnxruntime-node` 1.31.1 in `tools/silero-reference/`, fuori dal workspace pnpm; modello verificato tramite git blob e SHA-256.
  - **Fixture nuove:** `music-chords-v1..v3` (solo musica; `FIXTURES_VERSION` invariata).
  - **Risultato:** su fixture sintetiche libfvad chiama «voce» tutta la musica sola, mentre Silero scarta il 35% della voce sintetica.
  - **ADR-0023** (accettato il 2026-11-12): libfvad modo 2 come VAD principale; la musica non si delega al VAD.
- Specifica v0.3 con decisioni D1–D5 e modifiche Δ1–Δ21.
- ADR 0001–0014, backlog I-01…I-18, gate, registro dei rischi, protocollo di benchmark, checklist G0, glossario.
- `AGENTS.md`, `CLAUDE.md` e regole locali per `extension/`, `packages/dsp-core/`, `packages/crystal-core/`.
- Configurazione Claude Code: revisore avversariale, comandi `/gate-check`, `/new-adr`, `/session-end`.
- I-01: monorepo pnpm (Node 24, TypeScript `strict`) con gli otto pacchetti di SPEC §4, vuoti ma tipizzati.
- I-01: `packages/contracts` con i tipi di SPEC §9 trascritti alla lettera, guardie `isCrystalSeed`/`isSeedUnits`, `assertNever`, messaggio diagnostico `PING`/`PONG` separato da `CaptureMessage`.
- I-01: build MV3 multi-entry con Vite (service worker, content script IIFE, offscreen, worklet, worker, side panel, collezione, permesso) e Tailwind compilato localmente; manifest v0.3 di SPEC §5.
- I-01: guardia sul bundle **minificato**. `pnpm build` fallisce per:
  - gli identificatori `eval` e `Function` ovunque compaiano;
  - schemi URL nel codice, anche dentro template e concatenazioni, e nei file HTML, SVG, CSS e JSON;
  - tipi di file non scansionati;
  - CSP non conforme;
  - permessi, chiavi di manifest e match dei content script fuori da un elenco ammesso;
  - file referenziati mancanti.

  I falsi positivi si gestiscono con eccezioni motivate (`GUARD_EXCEPTIONS`, oggi vuoto). È un controllo testuale, non una prova: a runtime la CSP blocca l'esecuzione dinamica, non la rete (decisione D-A in STATUS).
- I-01: regole ESLint di purezza (R10, R11, R17, ADR-0010), con fixture non conformi e test che dimostrano che ogni regola scatta. Coprono:
  - i pacchetti puri: globali di browser, estensione, Node e rete; import di Node, Three.js e codice impuro; `import()`;
  - tutto `crystal-core`: casualità, orologi, `let`/`var` di modulo, alias di `Math` e `crypto`;
  - il percorso dei vertici: solo membri `Math` ammessi, nessun accesso indiretto a `Math`, nessun import con `..`.

  Limite dichiarato: lo stato mutabile dentro `const` non viene rilevato.
- I-01: E2E Playwright «estensione caricata, il service worker risponde al ping»; `tests/e2e/README.md`; voce M0 nella checklist manuale.
- I-01: workflow CI GitHub Actions (typecheck, lint, test, build, E2E sotto xvfb).
- ADR-0015: CSP delle pagine con `connect-src 'self'` (decisione D-A); guardia e E2E la verificano.
- I-04: `pnpm fixtures` genera 31 fixture WAV sintetiche deterministiche (`fixtures-1`) con `.meta.json` (valori attesi, traccia f0 vera ogni 10 ms) e `manifest.json` (SHA-256); `--check` verifica senza scrivere. WAV non versionati.
- I-04: `pnpm bench` (`tests/benchmarks/`) esegue `dsp-core` su ogni fixture e scrive un report JSON con ambiente e tempi.
- ADR-0016 (Accettato il 2026-11-10, con rilevamento sui frame attivi per energia): mix mono (L+R)/2 con ripiego su un canale e warning `PHASE_CANCELLATION` quando le fasi si cancellano (decisione D-E).
- I-05a: `dsp-core` con mix mono (ADR-0016), resampler razionale anti-alias a 16 kHz, frame, YIN (60–500 Hz, null fuori range), interfaccia `VadEngine` e pre-filtro a banda (solo diagnostica), `trackPitch` (`pitch-yin-0`).
- I-05a: `pnpm bench` misura M2 (errore f0 per frame e d'ottava rispetto alla traccia vera), bias della mediana, M3 per f0 e M12; fixture `voice-a-antiphase-partial`.
- `docs/BENCHMARK_PROTOCOL.md` §7: registro delle misure.
- I-10: `crystal-core` `habit-1`: corpi come intersezione di semispazi (prisma trigonale → trigonale smussato → esagonale → esagonale smussato → esagonale doppio; pinacoide, romboedri, bipiramide; secondari concresciuti; aghi e fantasma), SHA-256 e `xoshiro128**` propri, rumore continuo su reticolo (ADR-0018), `geometryHash` canonico, contratto `CrystalGeometry` in `packages/contracts`.
- I-10: 1.000 seed dorati (`pnpm test:golden`, `pnpm test:golden:browsers`, anche su bundle minificato), misura di continuità (`pnpm bench:continuity`), robustezza (`pnpm bench:robustness`), catalogo di 200 tavole (`pnpm catalog`).
- ADR-0018 (Accettato): casualità del generatore come rumore continuo su reticolo dei parametri geometrici.
- I-12: `renderer-svg` con `renderPlateSvg(geometry, view)`: tavola cristallografica del corpo primario, spigoli nascosti tratteggiati, viste clinografica, frontale e dall'alto, scala fissa, coordinate a 0,01 px con aritmetica intera; contratto `PlateView` e `PLATE_RENDERER_VERSION` (`plate-1`) in `packages/contracts`.
- I-12: 3.000 tavole dorate (`pnpm test:golden`, `pnpm test:golden:browsers`), misura della scala (`pnpm bench:plate-scale`, anche in CI); il catalogo (`pnpm catalog`) usa la tavola canonica.
- I-11: `renderer-three` con `renderCrystal(geometry, config)` e Three.js `0.186.1` (MIT): vetrina con `MeshPhysicalMaterial` (trasmissione, IOR, spessore, attenuazione, dispersione), `RoomEnvironment` + PMREM, luce chiave, ombra di contatto, tone mapping AgX, piatto girevole lento fermo con `prefers-reduced-motion`; profilo economy con la stessa mesh.
- I-11: normali di faccia da `planes[faceOfTriangle]`; nucleo puro in `packages/renderer-three/src/pure` sotto le regole di purezza (colore OKLCH, veli, budget, array), testato in Node.
- I-11: tratti velati smerigliati o sbiaditi, mai tolti; `veilIsVisible` dice quando non c'è un elemento da attenuare (lo segnalerà il cartellino, I-13). `checkBudget` per geometrie non fidate.
- I-11: ripiego sulla tavola SVG su `webglcontextlost`, WebGL assente o contesto già perso; geometria malformata → `RenderInputError`.
- I-11: `pnpm test:render` (Chromium, WebGL SwiftShader): immagini di riferimento con tolleranza, veli, 100 cicli monta/smonta con conteggio degli oggetti WebGL per contesto e heap JS, perdita di contesto; job CI `render-three`. `pnpm bench:render` per primo frame, frame time p50/p90/p95, 100 cicli con pause per la memoria GPU e confronto visivo dei veli (`--show`). Voci manuali M17–M19.
- I-11, chiusura: `pnpm bench:render --memory` per M18, senza misure dei frame. Pagina vuota di preparazione e fasi a tempo con conto alla rovescia nella pagina e nel terminale: prima, durante un cristallo, due tornate di 100 cicli ciascuna seguita da una lettura, una lettura a distanza. Il report si salva dopo ogni tornata; la chiusura della finestra non lo fa più fallire. Misure del product owner su Radeon RX Vega 10 registrate: M17; M18 superato (nessuna crescita dopo 200 cicli); M19 «accettabile», veli riconosciuti. I-11 chiusa.
- ADR-0020 (Accettato): la versione del renderer fa parte della promessa di identità byte per byte della tavola SVG.
- ADR-0019 (Accettato): nomi degli abiti di `habit-1` fedeli alla geometria («trigonale smussato», «esagonale doppio»); prismi ditrigonale e diesagonale veri rinviati a una versione futura (decisione L1).
- ADR-0017 (Accettato): stimatore f0 esteso a 60–1100 Hz per il canto; il frame intonato dei descrittori resta 60–500 Hz (decisione D-K).
- I-04: `dsp-core` con quantili tipo 7, mediana, IQR e `signalSummary` (`signal-summary-0`); nessun `extractorVersion` ancora.
- I-02: avvio dalla toolbar. In `action.onClicked`, `sidePanel.open()` sincrono come prima istruzione; poi offscreen con i soli motivi `USER_MEDIA` e `WORKERS`, creato una volta anche con richieste concorrenti; `tabCapture.getMediaStreamId` solo dopo l'offscreen e stream ID inviato una volta, mai salvato. Su pagine non `/watch` il pannello si apre e mostra `NOT_YOUTUBE_WATCH`; con una cattura già attiva, `CAPTURE_BUSY`.
- I-02: offscreen con `getUserMedia` sullo stream della scheda, pass-through verso le casse (`latencyHint: 'interactive'`) e AudioWorklet senza uscite che conta i campioni (nessun DSP, nessun PCM fuori dal worklet); uno stop unico e idempotente rilascia tracce, nodi e contesto e chiude il documento. Un avvio fallito chiude l'offscreen che aveva creato; due click concorrenti producono un solo avvio.
- I-02: pannello diagnostico in italiano: stato, campioni ricevuti, frequenza, latenze stimate dal browser, pulsante «Interrompi», messaggi d'errore, avviso se la cattura smette di aggiornarsi.
- I-02: messaggi interni in `contracts/src/internal.ts` (`OFFSCREEN_START_TAB`, `OFFSCREEN_STOP`, `CAPTURE_DIAG`), fuori da `CaptureMessage`, con guardie di tipo; guardia per `CAPTURE_STOP`.
- I-03: macchina di cattura di SPEC §6.1 come tabella tipizzata e pura (`extension/src/offscreen/capture-machine.ts`). I tempi [H] di 45 s di ascolto (orologio a campioni, pause escluse) e di 120 s assoluti portano a `FINALIZING`; senza rilevatore di voce l'esito è sempre `INSUFFICIENT_DATA`. Test a modello con fast-check: ogni stato arriva a `IDLE`, lo stop è accettato da ogni stato, nessuna transizione fuori tabella.
- I-03: watchdog di sessione (ADR-0004) in `CaptureSession`:
  - heartbeat accettati solo dalla scheda catturata, con il `sessionId` della sessione e `seq` crescente; gli altri sono ignorati e contati;
  - 3 s senza heartbeat o URL fuori da `/watch` → `NAVIGATED_AWAY`; altro `videoId` → `VIDEO_CHANGED`; velocità ≠ 1 → `PLAYBACK_RATE_CHANGED`; pausa → `PAUSED`;
  - seek → `VIDEO_SEEK`; cambio di sorgente → `AD_OR_SOURCE_CHANGE`;
  - un'unica uscita idempotente che rilascia tutto, emette il messaggio finale e torna a `IDLE`.
- I-03: content script su tutto `https://www.youtube.com/*` (ADR-0021), inerte finché il service worker non lega una sessione con `SESSION_BIND`. Poi invia l'heartbeat a 1 Hz e i `PLAYER_EVENT`, leggendo solo il `<video>` standard.
- I-03: instradamento in `chrome.storage.session` (`activeSession`), riletto a ogni risveglio del service worker. Segnali aggiuntivi: chiusura della scheda, navigazione rilevata da `tabs.onUpdated`, `tabCapture.onStatusChanged`. Un avvio rifiutato con `CAPTURE_BUSY` offre «Interrompi la cattura in corso», da qualunque scheda.
- I-03: pannello con stato, motivo dell'uscita (una stringa per ogni `CaptureExitReason`, compreso il limite dichiarato sugli annunci), tempo dall'avvio e tempo di ascolto.
- I-03: E2E `lifecycle.spec.ts` e `cycles.spec.ts`, con helper condivisi in `tests/e2e/harness.ts`: scenari S2, S3, S6 sintetico, S7, S8, cambio video, navigazione SPA, chiusura della scheda, due schede, 45 s, 120 s, 100 cicli con misura della memoria. Checklist manuale M3–M11 aggiornata.
- I-02 chiusa il 2026-11-11 senza la misura della latenza del pass-through (decisione del product owner); prove manuali M1–M3, M10 e M20 (30/30) in Brave.
- I-02: E2E `tab-capture.spec.ts`. Il click sull'icona è simulato con il comando CDP `Extensions.triggerAction` sul target `tab`, su una finta pagina `/watch` con tono sintetico; il test copre la pausa di 60 s e lo stop dal pannello. Voci manuali M20 (30 avvii) e M21 (latenza con loopback).
- I-18: sorgente file locale nel pannello, sezione «Da un file». Si scelgono il file e il punto di partenza, poi «Analizza».
  - **WAV:** intestazione letta senza fidarsi; si decodifica solo la finestra di 120 s, alla frequenza del file.
  - **Altri formati:** durata dai metadati di `<audio>`, decodifica intera a 48 kHz con budget di memoria [H] di 256 MB.
  - **Errori:** `FILE_TOO_LONG` oltre 30 minuti o oltre il budget, `FILE_DECODE_FAILED`.
- I-18: il `dsp-worker` ora esegue `dsp-core`. Il pannello ne avvia uno per analisi (ADR-0022, Accettato), gli trasferisce i campioni e riceve solo statistiche e digest (`pcm-analysis-0`); il PCM non lascia il pannello.
- I-18: un'analisi da file è una sessione per `CAPTURE_BUSY`, nei due versi. Messaggi interni `FILE_SESSION_END`, `FILE_SESSION_PING` e `FILE_SESSION_PONG` in `packages/contracts`. Il service worker riconosce una sessione file orfana (pannello chiuso) dal ping senza risposta.
- I-18: E2E `file.spec.ts`, 17 test. Il file entra con CDP `DOM.setFileInputFiles` (`harness.setPanelFile`); il doppio click è reale, con eventi del mouse CDP (`harness.mouseClicksInSidePanel`).
  - Misure: le 32 fixture confrontate con Node, la regola int16 → float del decoder di Chromium, `Math` in Node e nel pannello, la memoria del pannello con una controprova.
  - Unit: intestazione WAV (con property test), limiti, analisi, instradamento.
  - Voci manuali: M15 aggiornata, M24–M28; non ancora eseguite (TO DO non bloccante per decisione del product owner del 2026-11-12).
- I-18, dopo la revisione avversariale (CONDITIONAL GO):
  - un'eccezione imprevista non blocca più il pannello;
  - il worker viene terminato anche se l'invio fallisce o non risponde entro 60 s [H];
  - lo stop è immediato anche durante la decodifica;
  - «Interrompi» ignora i click per 500 ms [H], così il secondo click di un doppio click non ferma l'analisi (con controprova);
  - memoria ricontrollata dopo la decodifica con canali e lunghezza reali;
  - partenza oltre la fine rifiutata senza chiedere una sessione;
  - frequenze WAV che il resampler non converte passano al percorso a file intero;
  - fra un'analisi e l'altra si conserva solo il chunk `fmt `, non i primi byte del file;
  - il pannello delle catture ignora gli esiti dei file.
- Registro dei rischi: VC-24 (`dsp-core` non identico bit per bit fra motori JS), VC-25 (memoria dei file non WAV). Note di attuazione in ADR-0001 e ADR-0009.
- Decisioni su I-18 prese dall'agente per delega del product owner («soluzioni agili e sicure»):
  - D-N: VC-24 con cancello sul seed in I-07;
  - D-O: budget di memoria come stima più ricontrollo;
  - D-P: rifiuto dei file senza durata.

  ADR-0022 accettato dal product owner (D-M).

### Misurato
- I-18 (Chromium 156 contro Node 26.13, Windows 11):
  - il decoder di Chromium converte int16 come n / 32768 per i negativi e float32(n) × float32(1/32767) per i positivi; l'harness divide tutto per 32768;
  - `Math.log10`, `log`, `log2`, `exp`, `sin`, `cos`, `sinh` e `atan` danno risultati diversi di 1–2 ULP fra V8 14.6 e Chromium 156, sullo 0,2–6% degli ingressi; `sqrt`, `pow` e `hypot` sono identici;
  - con gli stessi campioni, la parte aritmetica dell'analisi coincide bit per bit con Node su 32 fixture su 32.

  Dettagli in `docs/BENCHMARK_PROTOCOL.md` §7.

### Modificato
- CI: il job principale non carica più la build dell'estensione come artefatto (ADR-0027).
- I-07: scheda e microfono non ascoltano più sempre 45 s. Con voce si fermano a 18 s di voce valida (`MAX_VALID_SPEECH`) o prima (`CONVERGED`). Un tono puro conta come voce per libfvad: si ferma a 18 s e finisce in `INSUFFICIENT_DATA`. Gli E2E del microfono e del tono lo verificano; M30 e M31 aggiornate.
- `dsp-core`, I-07: `descriptorsWithOnsets` (stesse misure di `computeDescriptors`, con gli onset contati altrove), `splitHalfAt`, `validSpeechSeconds`. `PcmAccumulator.snapshot` nell'estensione.
- `packages/contracts`, I-06b: `CAPTURE_DIAG` ha il campo `analysis` (`CaptureAnalysis`) e la guardia `isQualitySummary`; `dsp-core` esporta `describeFrames` e `FVAD_WASM_SHA256`.
- Backlog, I-06: divisa in I-06a (Node) e I-06b (estensione), decisione D-R. Clausola di `PATENTS` di WebRTC accettata dal product owner (D-S); domanda aperta per il G0 in `docs/LEGAL_G0_CHECKLIST.md` §4-bis.
- `dsp-core`, I-06a: `trackPitch` usa un aiuto condiviso con i frame acustici; il risultato non cambia.
- CI, I-18: il job `e2e` genera le fixture WAV (`pnpm fixtures`) prima dei test; `file.spec.ts` fallisce con un messaggio esplicito se ne manca una. I-18 mergiata (PR crystal-voice#13, `d6e1f51`).
- Backlog, I-05b: dipendenze approvate (D-L, decisa per delega del product owner). Nel bundle solo libfvad, compilato in WASM dal progetto con Emscripten fissato. Silero VAD solo in Node (`onnxruntime-node` 1.31.1, dipendenza di sviluppo) come riferimento del confronto.
- I-17, dopo la revisione avversariale: durante un avvio il pannello nasconde «Usa il microfono», così un doppio click non avvia due richieste. Se l'offscreen scompare senza messaggio finale, il pulsante torna disponibile. Una traccia già terminata durante la costruzione del grafo chiude la sessione. Con il permesso concesso, la scadenza dell'avvio riporta `STREAM_NOT_AVAILABLE`. L'instradamento di `CAPTURE_START` è estratto in `onCaptureStartRequest`. E2E `permission-page.spec.ts`; voce manuale M14c; nota di attuazione in ADR-0009. Emendamento di ADR-0011: l'arco `AUTHORIZING → INTERRUPTED` è accettato (decisione del product owner); i due archi da `FINALIZING` restano proposti.
- I-17: sorgente microfono nell'offscreen. Il pannello offre «Usa il microfono», controlla il permesso e, se manca, apre `permission.html`, che chiede il microfono e ferma subito le tracce. Il service worker accetta il `CAPTURE_START` di SPEC §9 solo per `mic` e invia `OFFSCREEN_START_MIC`. L'offscreen apre il microfono senza cancellazione d'eco, soppressione del rumore né AGC, e senza pass-through. La sessione resta viva finché resta aperta la porta del pannello (`vc-panel:<sessionId>`). `activeSession` e `lastStart` sono unioni discriminate su `source`; i segnali delle schede non fermano mai una sessione del microfono. E2E `mic.spec.ts` con il dispositivo finto di Chromium.
- I-03, dopo il merge: tolta dalla CI la diagnostica temporanea a 300 cicli (`VC_CYCLES`); il job E2E torna ai 100 cicli della DoD. Registrate in `docs/BENCHMARK_PROTOCOL.md` §7 le due corse Linux a 300 cicli col metodo finale della memoria (+7,3 e +6,5 MB, stabile).
- I-03: `CAPTURE_DIAG` porta lo stato di SPEC §6.1 (`CaptureState`), `exitReason`, `elapsedMs` e `activeMs`; `OFFSCREEN_START_TAB` porta la scheda; `OFFSCREEN_STOP` porta il motivo. Nuovi messaggi interni `SESSION_BIND` e `PLAYER_EVENT`; guardia per `HEARTBEAT`. Il manifest dichiara il content script su `https://www.youtube.com/*` (ADR-0021).
- I-03, dopo la revisione avversariale: rilascio della sessione limitato a 800 ms e protetto da errori; `lastStart` scritto prima di ogni `await`; timeout di 10 s in `AUTHORIZING`; uno stallo del video non conta più come cambio di sorgente; il `<video>` principale si sceglie per area; 500 ms di attesa prima di `STREAM_ENDED`. Il pannello non perde più l'offerta «Interrompi la cattura in corso» quando arriva la diagnostica della sessione attiva.
- I-02: i messaggi al service worker, all'offscreen e al pannello si accettano solo dai contesti dell'estensione (URL del mittente nell'origine dell'estensione), non dai content script. Prima eccezione della guardia del bundle: il confronto con `"https:"` in `isYoutubeWatchUrl`.
- I-11: aggirate due perdite di Three 0.186.1 (buffer dell'`InstancedMesh` di `RoomEnvironment`; LUT DFG condivisa che tratteneva ogni renderer smontato: heap da ~29 KB a ~3,5 KB per ciclo).
- Timeout espliciti di 30 s a due test pesanti di crystal-core (seed dorati, continuità), che sotto carico parallelo superavano i 5 s di default.
- I-10: Vite 8.3.5 anche fra le dipendenze di sviluppo della radice (già nel lockfile per l'estensione; MIT), per impacchettare `crystal-core` nel test dei browser. CI: job «golden hashes (Chromium, Firefox)».
- Contratti: `QualityWarning` include `PHASE_CANCELLATION` (ADR-0016; aggiunta retrocompatibile, nessun record persistito).
- Backlog: I-05 divisa in I-05a (pura) e I-05b (motori VAD, dipendenze da approvare); I-06 dipende da entrambe.
- I-04: la CI esegue `pnpm fixtures --check`, `pnpm fixtures` e `pnpm bench` (timeout 2 min, report come artefatto); ESLint ignora `.claude/worktrees/`; `.gitattributes` forza LF sui JSON delle fixture.
- Node fissato alla LTS attiva 26.13.0 (decisione D-D).
- AGENTS.md §8: l'elenco delle licenze ammesse vale per il bundle distribuito; licenze open source diverse ammesse per dipendenze di sviluppo annotate (decisione D-B).
- CI eseguita anche al push dei branch `issue/**`.

### Chiuso
- I-01 (PR crystal-voice#1, `16cea26`).
