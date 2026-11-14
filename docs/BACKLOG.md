# Backlog VoiceCrystal

18 issue in 5 fasi. Ogni issue è indipendente nel suo perimetro, ha una Definition of Done (DoD) verificabile e i test che la dimostrano. Vale sempre anche la DoD globale di `AGENTS.md` §8.

**Ordine consigliato.** La fase 1 (Chrome) e le fasi 2–3 (nucleo puro) possono procedere in parallelo. Le issue di fase 4 e 5 si sviluppano anche prima di G0, ma nulla si distribuisce finché G0 non è chiuso (ADR-0027, decisione D-AG del 2026-11-13; `docs/GATES.md`).

**Stime:** S ≤ 1 giorno, M 2–4 giorni, L 5+ giorni di lavoro di un agente con revisione umana. Sono ordini di grandezza, non impegni.

## Vista d'insieme

| Issue | Fase | Titolo | Dipende da | Stima | Gate |
|---|---|---|---|---|---|
| I-01 | 1 | Scheletro monorepo, build MV3, lint di purezza, CI | — | M | — |
| I-02 | 1 | PoC cattura scheda + pass-through + avvio | I-01 | M | G-PoC |
| I-03 | 1 | Watchdog, ciclo di vita, macchina di cattura | I-02 | M | G-PoC |
| I-17 | 1 | Sorgente microfono e pagina di permesso | I-01 | M | G-PoC |
| I-18 | 1 | Sorgente file locale | I-01, I-04 | S (effettiva M) | G-PoC |
| I-04 | 2 | Fixture sintetiche + harness offline | I-01 | M | G1 |
| I-05a | 2 | Mix mono, resampling, pitch YIN, interfaccia VAD | I-04 | M | G1 |
| I-05b | 2 | Motori VAD a confronto (libfvad, Silero) | I-05a | M | G1 |
| I-06a | 2 | Descrittori, confidenza, euristiche e seed in Node | I-05a, I-05b | M | G1 |
| I-06b | 2 | Estrazione nell'estensione (VAD nel `dsp-worker`, Node contro pannello) | I-06a, I-18 | M | G1 |
| I-07 | 2 | Arresto split-half | I-06a, I-06b | S | G1 |
| I-08 | 2 | Dataset umano + report G1 | I-06a, I-17 | L | G1 |
| I-09 | 2 | Tabelle quantili `mapping-1` e tabella G del comparator | I-08 | S | G1 |
| I-10 | 3 | crystal-core a semispazi | I-01 | L | G2 |
| I-11 | 3 | renderer-three «vetrina» | I-10 | L | G2 |
| I-12 | 3 | renderer-svg «tavola cristallografica» | I-10 | M | G2 |
| I-13 | 4 | Side Panel: home, nucleazione, rivelazione, cartellino | I-03, I-07, I-11, I-12 (G0 solo per la release) | L | Release |
| I-14 | 4 | Vault, miniature, export/import | I-10 (G0 solo per la release) | M | Release |
| I-15 | 4 | Comparator a percentile, Collezione, Confronto | I-09, I-14 (G0 solo per la release) | M | Release |
| I-16 | 5 | Hardening, accessibilità, SBOM, pacchetto | tutte | M | Release |

---

## Fase 1 — PoC Chrome

### I-01 · Scheletro monorepo, build MV3, lint di purezza, CI

**Stato:** chiusa il 2026-11-09 ([PR crystal-voice#1](https://github.com/alessandronardi/crystal-voice/pull/1), commit `16cea26`). Evidenze in `docs/STATUS.md`; M0 dichiarato dal product owner.

- **Riferimenti:** SPEC §4, §5; AGENTS.md §6; ADR-0001, ADR-0010.
- **Obiettivo:** repository che compila un'estensione caricabile e impone le regole di purezza.
- **Perimetro:** pnpm workspaces con i pacchetti di SPEC §4 (vuoti ma tipizzati); Vite multi-entry (service worker, content script, offscreen, worklet, worker, side panel, collection, permission); manifest v0.3; Tailwind locale; Vitest + fast-check; Playwright; `.nvmrc`; script dei comandi di AGENTS.md §6; CI (typecheck, lint, test, build).
- **Fuori perimetro:** qualunque logica audio o geometrica.
- **DoD:**
  - [x] `pnpm build` produce `dist/extension/` caricabile in Chrome 120 e nella stabile corrente senza errori nel pannello estensioni.
  - [x] Regola ESLint: nei pacchetti puri vietati `chrome`, `window`, `document`, `three`; in `crystal-core/src/geometry/` vietati `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log`.
  - [x] Un test dimostra che la regola scatta (file di esempio volutamente non conforme in `tests/lint-fixtures/`).
  - [x] CSP del manifest senza sorgenti remote; build fallisce se il bundle contiene `eval` o `new Function`.
  - [x] `tests/e2e/README.md` documenta come caricare l'estensione in Playwright e se l'headless è supportato (verificato o «non verificato»).
- **Test:** CI verde; E2E minimo «l'estensione si carica e il service worker risponde a un ping».

### I-02 · PoC cattura scheda + pass-through + avvio

- **Riferimenti:** SPEC §5; ADR-0001, ADR-0002, ADR-0003; VC-02, VC-03, VC-19.
- **Obiettivo:** dimostrare in Chrome reale che la cattura non compromette il player.
- **Stato:** mergiata il 2026-11-11 ([PR crystal-voice#9](https://github.com/alessandronardi/crystal-voice/pull/9), `18cb21e`). Chiusa il 2026-11-11 per decisione del product owner, senza la misura della latenza (M21 non eseguita). Prove manuali in Brave 1.99.56 (Chromium 157), non in Google Chrome. Merge prima di I-03 approvato: fino a I-03 R8 non vale, nessuna build distribuita. Evidenze in `docs/STATUS.md`.
- **Perimetro:** `action.onClicked` con `sidePanel.open()` sincrono; `ensureOffscreen()` con `USER_MEDIA`, `WORKERS`; `getMediaStreamId`; `getUserMedia` nell'offscreen; pass-through con `latencyHint: 'interactive'`; AudioWorklet che conta i campioni ricevuti (nessun DSP); stop pulito.
- **DoD:**
  - [x] 30 avvii manuali consecutivi su un video di riferimento: pannello aperto, audio udibile, nessun doppio audio, stop ripristina l'audio normale (M20: 30/30 in Brave 1.99.56, Chromium 157).
  - [x] Pausa di 60 s: offscreen vivo (verifica `chrome.runtime.getContexts`). E2E in Chromium 156 con controprova `AUDIO_PLAYBACK`; M3 in Brave.
  - [ ] Ritardo aggiunto dal pass-through misurato con loopback e registrato (valore, metodo, hardware); obiettivo ≤ 45 ms [H]. **Non eseguito:** misura acustica non riuscita; issue chiusa senza questa voce per decisione del product owner (2026-11-11). VC-19 resta aperto.
  - [x] Verificato se esiste un flag di Chrome che permette di automatizzare il gesto su `tabCapture`; esito scritto in `tests/e2e/README.md` (nessun flag: CDP `Extensions.triggerAction` sul target `tab`).
  - [x] Se l'automazione non è possibile: `tests/e2e/MANUAL_CHECKLIST.md` con i passi e gli esiti attesi (gesto automatizzato; checklist aggiornata per l'ascolto: M1–M3, M10, M20, M21).
- **Test:** E2E dove automatizzabile; altrimenti checklist manuale firmata nel verbale G-PoC.

### I-03 · Watchdog, ciclo di vita, macchina di cattura

- **Riferimenti:** SPEC §5, §6, §14; ADR-0004, ADR-0011; VC-04, VC-14, VC-16, VC-21.
- **Obiettivo:** nessuna cattura orfana, nessuno stato perso.
- **Perimetro:** heartbeat del content script; watchdog nell'offscreen; `stopSession(reason)` unico e idempotente; macchina di cattura a tabella (§6.1) con tempi 45/120 s su orologio a campioni; `chrome.storage.session` per l'instradamento; `CAPTURE_BUSY`; rilevazione di seek, rate, cambio video, sospetto annuncio (§6).
- **DoD:**
  - [ ] Test a modello della macchina: ogni stato raggiunge `IDLE`; `stop()` accettato da ogni stato; nessuna transizione non dichiarata.
  - [ ] Scenari S2 (pausa), S3 (navigazione esterna, stop ≤ 3 s), S6 (annuncio, rilevato o dichiarato), S7 (rate 1,5×), S8 (service worker terminato da `chrome://serviceworker-internals`) eseguiti in Chrome reale con esito registrato.
  - [ ] 100 cicli start/stop: nessun crash; crescita di memoria dell'offscreen ≤ 20 MB [H].
  - [ ] Doppio click sull'icona e due schede: una sola sessione, la seconda riceve `CAPTURE_BUSY`.
- **Test:** unit (macchina, watchdog con timer finti); E2E o checklist manuale per gli scenari.

### I-17 · Sorgente microfono e pagina di permesso

- **Riferimenti:** SPEC §2, §5; ADR-0009.
- **Obiettivo:** «La tua voce» dal microfono con lo stesso percorso dell'offscreen.
- **Perimetro:** `permission.html` aperta in scheda dal pannello per la prima autorizzazione; `mic-source.ts` nell'offscreen; nessun pass-through; stop alla chiusura del pannello o a 120 s; errore `MIC_PERMISSION_REQUIRED`.
- **DoD:**
  - [ ] Verificato in Chrome reale se l'offscreen può usare il microfono dopo l'autorizzazione data in una pagina dell'estensione; esito documentato (`needs current-doc verification` chiuso). Se non può: ADR che sposta la cattura microfono nella pagina visibile.
  - [ ] Indicatore di registrazione di Chrome visibile durante l'uso, assente dopo lo stop.
  - [ ] E2E con `--use-fake-device-for-media-stream` e un file WAV sintetico come ingresso.
- **Test:** E2E con dispositivo finto; checklist manuale con microfono reale.

### I-18 · Sorgente file locale

- **Riferimenti:** SPEC §5, §9; ADR-0009, ADR-0022.
- **Stato:** mergiata il 2026-11-12 ([PR crystal-voice#13](https://github.com/alessandronardi/crystal-voice/pull/13), `d6e1f51`), non chiusa: prove manuali M15 e M24–M28 TO DO, non bloccanti per le issue successive (decisione del product owner). Taglia effettiva M, non S: è la prima issue che fa girare `dsp-core` nell'estensione. Evidenze in `docs/STATUS.md`.
- **Decisioni del product owner (2026-11-12):**
  - D1: DSP in un worker del pannello (ADR-0022);
  - D2: il file è una sessione per `CAPTURE_BUSY`;
  - D3: WAV a finestra, altri formati decodificati interi con un budget di memoria [H];
  - D4: per ora il confronto con l'harness si fa su segnale, `signalSummary` e traccia di pitch; il seed in I-07.
- **Decisioni D-M…D-P (2026-11-12, in `docs/STATUS.md`; D-N…D-P per delega del product owner):**
  - D-M (del product owner): ADR-0022 accettato;
  - D-N: cancello sul seed in I-07 per VC-24;
  - D-O: budget di memoria come stima più ricontrollo;
  - D-P: rifiuto dei file senza durata.
- **Obiettivo:** analizzare un file scelto dall'utente con lo stesso DSP.
- **Perimetro:** `<input type="file">` nel pannello; `decodeAudioData`; scelta del punto di partenza; primi 120 s; PCM al `dsp-worker`; errori `FILE_DECODE_FAILED`, `FILE_TOO_LONG`.
- **DoD:**
  - [ ] Le fixture sintetiche di I-04 caricate come file producono lo stesso seed dell'harness Node (bit per bit, o differenza spiegata dal resampling e documentata).
  - [ ] Il contenuto del file non viene mai persistito; nel record resta solo il nome.
- **Test:** E2E con file di fixture; unit sulla validazione dei limiti.

## Fase 2 — DSP offline e calibrazione

### I-04 · Fixture sintetiche + harness offline

**Stato:** chiusa il 2026-11-10 ([PR crystal-voice#3](https://github.com/alessandronardi/crystal-voice/pull/3), merge squash `eaddd6b`). Evidenze in `docs/STATUS.md`.

- **Riferimenti:** SPEC §15; `docs/BENCHMARK_PROTOCOL.md`; R16.
- **Obiettivo:** banco di prova riproducibile senza audio reale.
- **Perimetro:** `scripts/fixtures/` genera WAV (silenzio, toni, sweep, rumori, impulsi, clipping, controfase, voce sintetica con f0 noto, A+B, alternanza A/B, voce + musica sintetica a −6/−12/−18 dB, voce compressa 4:1) con seed fissi; harness `pnpm bench` che esegue `dsp-core` su ogni fixture e scrive JSON.
- **DoD:**
  - [x] `pnpm fixtures` è deterministico (hash dei WAV stabile). Verificato su Windows e su Linux (CI).
  - [x] Ogni fixture ha un file `.meta.json` con parametri di generazione e valori attesi (es. f0 vero).
  - [x] `pnpm bench` gira in CI in meno di 2 minuti [H]. 1 s con il solo `signal-summary-0`.
- **Test:** hash delle fixture; smoke test dell'harness.

### I-05 · Pitch YIN + VAD a confronto (divisa in I-05a e I-05b)

Divisa il 2026-11-10 su decisione del product owner. I due VAD portano dipendenze runtime da approvare (AGENTS.md §10): Silero richiede onnxruntime-web, con WASM da circa 10–12 MB; libfvad va compilato in WASM. La parte pura non deve aspettarle.

### I-05a · Mix mono, resampling, pitch YIN, interfaccia VAD

- **Riferimenti:** SPEC §7.1–§7.4; ADR-0016, ADR-0017; `docs/BENCHMARK_PROTOCOL.md` M2, M12.
- **Perimetro:** mix mono con test in controfase (ADR-0016); resampling anti-alias a 16 kHz; frame; YIN con confidenza e periodicità; interfaccia `VadEngine` e pre-filtro RMS + banda (solo diagnostica); analizzatore di pitch nel bench.
- **Stato:** chiusa il 2026-11-10 ([PR crystal-voice#4](https://github.com/alessandronardi/crystal-voice/pull/4), merge squash `0c73dba`). Evidenze in `docs/STATUS.md`.
- **DoD:**
  - [x] Errore mediano f0 ≤ 1% e errori d'ottava ≤ 2% sulle fixture con f0 noto, oppure valori misurati riportati e soglia rinegoziata in ADR. Misurato 0,21% e 0,00%, solo su voci sintetiche.
  - [x] Mix mono secondo ADR-0016, con test su controfase completa, parziale e stereo in fase.
  - [x] Anti-alias verificato, con attenuazione misurata riportata.
  - [x] Interfaccia `VadEngine` per motori sincroni a 20 ms (adatta a libfvad); pre-filtro marcato non primario. La forma definitiva, che deve ospitare anche Silero (finestre da 512 campioni, inferenza asincrona), si fissa in I-05b.
  - [x] `pnpm bench` riporta M2 e M12; tempo in CI sotto i 2 minuti. CI 6 s, locale 5,8 s.
- **Test:** unit e property su `dsp-core`; benchmark registrato.

### I-05b · Motori VAD a confronto

- **Riferimenti:** SPEC §7.2; VC-11; interfaccia `VadEngine` di I-05a.
- **Perimetro:** integrazione di WebRTC VAD (libfvad, WASM compilato dal progetto) e Silero VAD (ONNX) dietro `VadEngine`; confronto sulle fixture.
- **Prima di iniziare:** approvazione delle dipendenze (licenza, dimensione, packaging, compatibilità con CSP e offscreen) da parte del product owner. **Fatto il 2026-11-11 (D-L, decisa dall'agente per delega del product owner; vedi sotto).**
- **Dipendenze approvate (D-L):**
  - **WebRTC VAD nel bundle:** libfvad (`dpirch/libfvad`, BSD-3-Clause), sorgente fissato a un commit.
    - Compilato in WASM dal progetto, con Emscripten fissato in un'immagine Docker `emscripten/emsdk` di versione esatta, pubblicata da almeno due settimane al momento della scelta.
    - Script di build nel repository; il `.wasm` committato con il suo SHA-256; un job CI lo ricompila e confronta l'hash.
    - Niente codice JS generato che usi `eval` o `new Function` (R2). La CSP ammette già `'wasm-unsafe-eval'`.
    - Si carica nell'offscreen, o nel `dsp-worker`, dal bundle, mai da rete.
    - Sincrono, frame da 20 ms a 16 kHz: entra nell'attuale `VadEngine` senza cambiarla. La modalità di aggressività è [H].
    - Dimensione da misurare e riportare: attese decine di KB.
  - **Silero VAD solo in Node, come riferimento del confronto:** `onnxruntime-node` 1.31.1 (MIT), dipendenza di sviluppo, fuori dal bundle.
    - Modello ONNX dalla release ufficiale `snakers4/silero-vad` (MIT), con tag e SHA-256 fissati. Lo scarica uno script di sviluppo in una cache ignorata da git: mai a runtime (R2).
    - Un adattatore porta le decisioni a 32 ms (512 campioni) sui frame da 20 ms, solo nel bench.
    - **Motivo dell'esclusione dal bundle:** `onnxruntime-web` 1.31.1 aggiungerebbe da 14,8 a 29,5 MB di WASM, più circa 2,3 MB di modello, e un'interfaccia asincrona.
  - **Se le misure smentiscono WebRTC** (falsi positivi su musica inaccettabili), portare Silero nel bundle è una nuova decisione del product owner: dimensione, interfaccia asincrona, eventuale ADR sulla CSP.
  - **Limite del confronto:** le voci delle fixture sono sintetiche (sorgente-filtro). Un VAD neurale addestrato su parlato reale può rifiutarle, quindi il confronto su fixture non è rappresentativo del parlato reale. La conferma è al G1, con i dati di I-08.
  - **Fuori da I-05b:** il resampler con stato per il percorso a blocchi del `dsp-worker` (eredità di I-05a), che serve quando il VAD entra nel worker (I-06).
- **Eredità da I-05a:** `VadEngine` è sincrona e a 20 ms; per Silero serve un adattatore asincrono con buffering, o un'interfaccia rivista, con una suite di conformità comune. Il resampler è solo a buffer intero: il percorso a blocchi del worker ne richiede uno con stato.
- **DoD:**
  - [x] Tabella comparativa dei due VAD: falsi positivi su musica, falsi negativi su voce sintetica, dimensione bundle, licenza, tempo per secondo di audio. In ADR-0023 e in `docs/BENCHMARK_PROTOCOL.md` §7 (`pnpm bench:vad:silero`, 2026-11-12), solo su fixture sintetiche.
  - [x] ADR con la scelta del VAD: ADR-0023, accettato dal product owner il 2026-11-12 (modo 2).
- **Stato:** chiusa il 2026-11-12 ([PR crystal-voice#14](https://github.com/alessandronardi/crystal-voice/pull/14), merge squash `f61c291`; CI della PR verde). ADR-0023 accettato. La clausola di `PATENTS` va accettata prima che il `.wasm` entri in `dist/` (I-06, I-16). Evidenze in `docs/STATUS.md`.
- **Test:** unit su fixture; benchmark registrato.

### I-06 · Sei descrittori, confidenza, euristiche musica e più voci

Divisa il 2026-11-12 su decisione del product owner (D-R), come I-05: **I-06a** tutta in Node, **I-06b** nell'estensione. Riferimenti comuni: SPEC §7.2–§7.5; ADR-0006, ADR-0014, ADR-0016, ADR-0017, ADR-0022, ADR-0023, ADR-0024 (accettato); VC-10–VC-13, VC-24.

#### I-06a · Descrittori, confidenza, euristiche e seed in Node

- **Perimetro:**
  - frame acustici (SPEC §7.3) con libfvad modo 2;
  - formule `EXPERIMENTAL v0`, con le modifiche di ADR-0024 (D-V): livello normalizzato, p3 e p6 sui frame intonati;
  - confidenza per parametro (D-U);
  - warning `MIXED_AUDIO_UNCERTAIN` e `MULTI_SPEAKER_SUSPECTED` (D-T);
  - `mapping-0-experimental` in `packages/calibration`, seed interi half-even;
  - `extractor-0-experimental`;
  - `pnpm bench:descriptors`.
- **DoD** (misure del 2026-11-12, `docs/BENCHMARK_PROTOCOL.md` §7):
  - [x] Invarianza: ±6 dB e 44,1/48 kHz → Δ ≤ 1 punto per parametro. Misurato: al massimo 0,09 punti, grazie alla normalizzazione di livello (D-V, ADR-0024). Con le formule alla lettera erano fino a 7 punti.
  - [x] Silenzio, toni, rumore → nessun cristallo. Misurato su 19 casi su 19: 12 fixture, compresi sweep, impulsi e accordi, più 7 segnali lunghi da 30–40 s generati in memoria. **Vale per toni stazionari e accordi.** Lacuna trovata dalla revisione (H-1): toni a impulsi e melodie a note brevi (80–190 ms) danno un cristallo senza avvisi, 5 casi su 5. Sono tracciati come «lacuna nota» (`it.fails`) in `tests/unit/descriptors-fixtures.test.ts`.
  - [x] Voce + musica a −12 dB → `MIXED_AUDIO_UNCERTAIN` in almeno il 90% delle varianti [H]. Misurato: 5 su 5.
  - **Nota (revisione H-2):** le soglie [H] nuove sono state fissate guardando queste stesse fixture. Le cifre di questa DoD sono quindi **tarate e valutate sullo stesso set (in-sample)**: non dicono come va su audio nuovo. La prova fuori campione è al G1, con I-08.
  - [x] Alternanza A/B → `MULTI_SPEAKER_SUSPECTED` in almeno il 90% delle varianti [H], o valore misurato. **Misurato: 2 su 3 (67%), sotto l'obiettivo**; la v2 non viene rilevata. Valore riportato come ammette la DoD.
  - [x] Voce compressa 4:1 → Δp3 misurato e riportato (VC-10): −8,5 dB, −28,9 punti.
- **Test:** property test (nessun `NaN`, range, interi); fixture; impronta della versione.
- **Stato:** chiusa il 2026-11-12 ([PR crystal-voice#15](https://github.com/alessandronardi/crystal-voice/pull/15), merge squash `fe0c58e`; CI della PR verde). ADR-0024 accettato. La voce A/B è chiusa con il valore misurato, come ammette la DoD; lacuna nota delle note brevi tracciata con `it.fails`.

#### I-06b · Estrazione nell'estensione

- **Dipende da:** I-06a.
- **Perimetro** (decisioni del product owner: D-W scheda e microfono inclusi; D-X licenze dalla CI; D-Y risultato in `CAPTURE_DIAG.analysis`; D-Z navigazione durante l'analisi finale non scarta, «Interrompi» sì; D-AA i file chiedono 8 s di voce valida come la cattura; D-AB riferimento del cancello D-N con la conversione di Chromium; D-AC ADR-0025 accettato):
  - `fvad.wasm` in `dist/`, fissato per SHA-256 nella guardia del bundle, e caricato nel `dsp-worker` sotto la CSP, solo tramite `instantiateFvad` dopo il controllo dell'hash;
  - percorso file del pannello fino al seed, con righe tecniche «sperimentali»;
  - scheda e microfono: il worklet inoltra l'audio di ascolto al `dsp-worker` dell'offscreen; analisi a fine sessione, sul buffer intero, con la stessa funzione dei file (ADR-0025);
  - nel pacchetto: `THIRD_PARTY/libfvad/LICENSE`, `PATENTS` e le note di musl, dlmalloc, compiler-rt ed Emscripten (ADR-0023, D-S).
  - **Fuori, verso I-07:** resampler con stato, guadagno stimato in corsa ed estrazione incrementale: servono alla regola split-half, non all'analisi a fine sessione.
- **DoD** (misure del 2026-11-12, `docs/BENCHMARK_PROTOCOL.md` §7):
  - [x] `fvad.wasm` caricato nel `dsp-worker` sotto la CSP attuale, E2E con finestra e headless: pannello (file) e offscreen (scheda, microfono).
  - [x] Decisioni del VAD e seed delle fixture caricate come file: uguali fra Node e pannello, con in Node la stessa conversione dei campioni di Chromium (D-AB). Misurato: 35 fixture su 35 con esito, avvisi, confidenza, qualità e decisioni VAD identici, e i 19 seed presenti identici; misure grezze diverse al più di 2 ULP in 8 valori. **Contro il lettore WAV dei benchmark** (int16/32768, diverso da Chromium da I-18) la differenza è misurata e dichiarata, non richiesta: vedi `docs/BENCHMARK_PROTOCOL.md` §7. Il cancello D-N resta in I-07, per la verifica finale.
  - [x] Estrazione a blocchi = estrazione a buffer intero: per costruzione (ADR-0025), con il test unit bit per bit dell'accumulatore.
- **Test:** unit sui blocchi; E2E Node contro pannello.
- **Stato:** mergiata il 2026-11-13 ([PR crystal-voice#16](https://github.com/alessandronardi/crystal-voice/pull/16), merge squash `c11a0d4`; CI della PR verde). **Non chiusa:** restano le prove manuali M29–M31 in Brave (`tests/e2e/MANUAL_CHECKLIST.md`), TO DO non bloccante (decisione del product owner, 2026-11-13): I-07 può partire. ADR-0025 accettato.

### I-07 · Arresto split-half

- **Riferimenti:** SPEC §8; ADR-0008; ADR-0026 (accettato il 2026-11-13, D-AF); VC-07.
- **Decisioni del product owner (2026-11-13):** D-AD, durante l'ascolto si rianalizza l'audio raccolto a ogni secondo con la stessa funzione del risultato finale (nessun calcolo a pezzi); D-AE, τ resta 6 anche se la voce sintetica non converge, la soglia si misura in G1.
- **Fuori perimetro, in «Proposte» di STATUS:** gli eventi `VAD_PAUSE` / `VOICE_RESUMES` (stato `WAITING_FOR_SPEECH`); il calcolo a pezzi, se il carico misurato lo chiederà.
- **DoD** (misure del 2026-11-13, `docs/BENCHMARK_PROTOCOL.md` §7):
  - [x] Mai `CONVERGED` prima di 8 s o senza copertura: la prima valutazione è a 8 s di voce valida, il primo arresto possibile a 10 s; un descrittore mancante, una metà incompleta o «più voci» bloccano (`extension/test/split-half-rule.test.ts`, anche come property test).
  - [x] Fixture A+B: nessun `CONVERGED` a cavallo del cambio di voce (`tests/unit/stop-rule-voices.test.ts`).
    - `a-then-b` e `alternating-ab-v1…v3` sono troppo corte perché le metà misurino tutti i tratti (revisione H-3): le valutazioni sono bloccate da «più voci» o da metà incomplete, e lo split-half non arriva mai a confrontare le due voci.
    - Per questo c'è anche un caso lungo, generato in memoria: voce regolare A per 10 s, poi voce regolare B. Dopo il cambio le metà sono complete e si somigliano, perché contengono entrambe le voci; solo l'avviso «più voci», che resta in attesa per tutta la sessione (revisione H-1), impedisce `CONVERGED`. Esito `MAX_VALID_SPEECH`.
  - [x] Tutti i motivi d'uscita prodotti dalle fixture appropriate:
    - `MAX_VALID_SPEECH`: `voice-a-long` e il tono di 46 s;
    - `WALL_TIMEOUT`: 46 s di silenzio;
    - `CONVERGED`: il controllo positivo regolare;
    - `ABSOLUTE_TIMEOUT` e i motivi `INTERRUPTED`: sequenze di eventi e tempi nei test della macchina e della sessione, ed E2E esistenti.
  - [x] Timeout (45 s attivi, 120 s assoluti). **Semantica** (SPEC §6.1, invariata, ora con la voce valida vera):
    - il tempo attivo si conta sul clock dei campioni solo in `LISTENING` e `WAITING_FOR_SPEECH`; a 45 s → `FINALIZING` / `WALL_TIMEOUT`;
    - il tempo assoluto si conta da `START`, pause comprese; a 120 s → `FINALIZING` / `ABSOLUTE_TIMEOUT`, anche in `PAUSED`;
    - la voce valida è quella dell'ultima valutazione del worker (frame utili del prefisso); a 18 s, solo in `LISTENING` → `FINALIZING` / `MAX_VALID_SPEECH`. Se una valutazione arriva tardi, la sessione può ascoltare qualche decimo di secondo oltre i 18 s;
    - se la convergenza è già arrivata quando scatta il `TICK`, vince `CONVERGED`: la sessione la applica prima del `TICK`;
    - in `FINALIZING` nessun limite: c'è solo il tempo massimo di 15 s dell'analisi finale;
    - qualunque uscita da `FINALIZING` passa da `QUALITY`, con la regola degli 8 s.

    Verificata con sequenze di eventi e tempi (`capture-machine.test.ts`, `capture-session.test.ts`) e con i segnali sopra. **Controllo positivo, con un limite dichiarato:**
    - `MAX_VALID_SPEECH` su `voice-a-long`: sì;
    - `CONVERGED` su `voice-a-long`: **no**, con τ = 6 le metà restano a 8–16 punti (D-AE). Il controllo positivo di `CONVERGED` è una voce sintetica molto regolare, che converge però con p6 saturo: prova la catena, non la soglia.
  - [x] **Eredità da I-18 (D4, 2026-11-12):** le fixture di I-04 caricate come file nel pannello danno lo stesso seed dell'harness Node, o una differenza spiegata e documentata. L'E2E di I-18 (`tests/e2e/file.spec.ts`) confronta oggi segnale a 16 kHz, `signalSummary` e traccia di pitch: va esteso al seed. Due differenze sono già note e misurate in I-18: la regola int16 → float del decoder di Chromium, e `Math.log10`, `sin` e `cos` non identici fra le versioni di V8 (`docs/BENCHMARK_PROTOCOL.md` §7). Il seed è quantizzato: va verificato se differenze di 1–2 ULP possono spostarlo di una casella. **Cancello (D-N):** se anche un solo seed differisce fra Node e pannello, prima di proseguire serve un ADR che porti in `dsp-core` implementazioni proprie di `log10`, `log2`, `sin`, `cos`, `sinh` (come ADR-0010).
    - **Esito:** il confronto del seed è in `tests/e2e/file.spec.ts` da I-06b: 19 seed su 19 identici con la conversione di Chromium (D-AB); la differenza dal lettore dei benchmark è misurata e dichiarata. Margine dal confine di arrotondamento: al minimo 0,000354 unità, contro circa 10⁻¹² per ULP. Il cancello non scatta; va ripetuto a ogni Chrome nuovo (VC-24).
- **Test:** unit su fixture e su sequenze sintetiche di descrittori.
- **Stato:** mergiata il 2026-11-13 ([PR crystal-voice#17](https://github.com/alessandronardi/crystal-voice/pull/17), merge squash `032ac93`; CI della PR verde). **Non chiusa:** restano le prove manuali M32–M34 in Brave (`tests/e2e/MANUAL_CHECKLIST.md`). ADR-0026 accettato.

### I-08 · Dataset umano + report G1

- **Riferimenti:** SPEC §15; `docs/BENCHMARK_PROTOCOL.md`; `docs/GATES.md` G1.
- **Perimetro:** raccolta con consenso scritto (almeno 15 parlanti × 4 segmenti × 2 microfoni); conservazione fuori repository; esecuzione del protocollo; report.
- **DoD:**
  - [ ] Moduli di consenso archiviati fuori repository; nel repository solo identificativi anonimi e descrittori.
  - [ ] Report G1 con tutte le metriche del protocollo, casi di fallimento e decisioni motivate.
  - [ ] Revisione avversariale indipendente del report.
- **Nota:** richiede persone reali. **Un agente non può completarla da solo**: prepara script, moduli e procedura; un umano raccoglie.

### I-09 · Tabelle quantili `mapping-1` e tabella G del comparator

- **Riferimenti:** ADR-0006, ADR-0007.
- **DoD:**
  - [ ] Tabelle calcolate solo sul set di calibrazione; valutazione sul set separato.
  - [ ] Distribuzione dei seed sul set di valutazione vicina all'uniforme (test di Kolmogorov-Smirnov riportato).
  - [ ] Percentile di vicinanza mediano per coppie di parlanti diversi tra 45 e 55.
  - [ ] `mappingVersion = mapping-1` e `comparatorVersion = comparator-1` congelate.

## Fase 3 — Crystal core e renderer

### I-10 · crystal-core a semispazi

- **Riferimenti:** SPEC §10; ADR-0005, ADR-0010, ADR-0018, ADR-0019; `packages/crystal-core/CLAUDE.md`.
- **Stato:** mergiata ([PR crystal-voice#5](https://github.com/alessandronardi/crystal-voice/pull/5), `e2a131f`), non chiusa: revisione estetica G2 da fare. Evidenze in `docs/STATUS.md`.
- **Perimetro:** intersezione di semispazi; forme ammesse; cammino continuo di `p1`; terminazioni; secondari da dimensione 0; inclusioni; quantizzazione; PRNG per dominio; SHA-256; `geometryVersion = habit-1`; seed dorati.
- **DoD:**
  - [x] 1.000 seed dorati: hash identici in Node, Chrome, Firefox. Node e Chromium in locale; Chromium e Firefox in CI (run 42826775595).
  - [x] Property test: convessità, Eulero, winding, coordinate finite, budget triangoli.
  - [x] Continuità: Δ di 100 unità → 1 − IoU ≤ 0,03 [H] su 10.000 coppie casuali, o valore misurato e soglia in ADR. Massimo misurato 0,0252 sul campione di verifica (0,0248 su quello di taratura).
  - [x] Catalogo visivo di 200 seed (tavole SVG) per la revisione estetica G2: `pnpm catalog`. La revisione è umana e spetta al G2.
- **Test:** unit, property, golden.

### I-11 · renderer-three «vetrina»

- **Riferimenti:** SPEC §10; ADR-0012, ADR-0014.
- **Stato:** mergiata il 2026-11-10 ([PR crystal-voice#7](https://github.com/alessandronardi/crystal-voice/pull/7), `424bfc3`), CI verde anche su Linux. Chiusa il 2026-11-10: M17 eseguito, M18 superato (due tornate), M19 «accettabile» con veli riconosciuti; taratura estetica al G2. Evidenze in `docs/STATUS.md`.
- **DoD:**
  - [x] Materiale, ambiente procedurale, luce, ombra, piatto girevole, economy; versione di Three.js fissata e funzioni usate verificate su quella release. Resa «accettabile» per il product owner (M19); taratura estetica al G2.
  - [x] Tratti velati resi in modo riconoscibile («si riconoscono», product owner su GPU reale, M19).
  - [x] `webglcontextlost` → ripiego sulla tavola SVG senza crash (perdita simulata in Chromium, anche su Linux in CI).
  - [x] 100 cicli monta/smonta senza crescita di memoria GPU (M18: 3.040 K prima e dopo 100 e 200 cicli).
  - [x] Tempo di primo frame e frame time p50/p90/p95 misurati su hardware di riferimento documentato (M17, Radeon RX Vega 10, 2026-11-10).
- **Test:** screenshot di riferimento con tolleranza; test di dispose.

### I-12 · renderer-svg «tavola cristallografica»

- **Riferimenti:** SPEC §10; ADR-0013, ADR-0020.
- **Stato:** chiusa il 2026-11-10 ([PR crystal-voice#6](https://github.com/alessandronardi/crystal-voice/pull/6), merge squash `06c5836`). Evidenze in `docs/STATUS.md`.
- **DoD:**
  - [x] Spigoli visibili e nascosti corretti sui seed dorati (verifica visiva + test sul conteggio). Test sul conteggio; verifica visiva del product owner sul catalogo il 2026-11-10.
  - [x] SVG byte-identico fra esecuzioni e fra Node e browser. Node e Chromium in locale; Chromium e Firefox in CI (run 42850801115).
  - [x] SVG valido, con `<title>` e `<desc>` per l'accessibilità.

## Fase 4 — Prodotto (sviluppabile; distribuzione bloccata fino a G0, ADR-0027)

### I-13 · Side Panel: home, nucleazione, rivelazione, cartellino

- **Riferimenti:** SPEC §6.2, §13; ADR-0011, ADR-0014.
- **Divisa il 2026-11-13** (piano approvato dal product owner), come I-05 e I-06:
  - **I-13a, percorso principale:**
    - macchina della vista pura (`HOME → LIVE → REVEALED | OUTCOME → HOME`);
    - Home con le tre sorgenti e l'avviso G0-DOC-01 (elaborazione locale, artistica, non biometrica; link alle licenze in `THIRD_PARTY/`);
    - ascolto come nucleazione: germe «in crescita, provvisorio» e «voce utile X / 18 s»;
    - rivelazione con la vetrina di `renderer-three` (tavola SVG senza WebGL), cartellino, «Scarta» ed export della tavola SVG;
    - esiti espliciti;
    - le righe tecniche di oggi in «Dettagli tecnici».
    - «Salva» e gli ultimi esemplari sono di I-14.
    - Mergiata il 2026-11-14 (PR crystal-voice#18, squash `739fb03`), non chiusa: prove manuali M35–M37 TO DO.
  - **I-13b, completamento** (branch `issue/I-13b-side-panel`; decisioni D-AL…D-AQ in `docs/STATUS.md`; ADR-0028 Proposto):
    - legenda viva interattiva;
    - avviso più voci con risposta (`MULTI_SPEAKER_ANSWER`);
    - `chooseProfile`;
    - tratti velati segnalati nel cartellino;
    - axe-core senza violazioni serie.
  - **Rinvii dichiarati da I-13a** (revisione del 2026-11-13): provenienza YouTube sul cartellino (in attesa dell'ADR di G0-TECH-01), font OFL da includere, avvisi di qualità sul cartellino (I-13b), «Voce non rilevata» quando la cattura emetterà `WAITING_FOR_SPEECH`.
  - **Prescrizioni G0 che toccano I-13:** G0-DOC-01 (I-13a) e G0-DOC-02, cioè «Affinità acustica / geometrica» nei testi del confronto (I-15). G0-TECH-01 e G0-TECH-03 chiedono ADR propri (`docs/STATUS.md`).
- **DoD** (vale per I-13a e I-13b insieme):
  - [ ] Tutte le schermate e gli stati di SPEC §13, compresi errori espliciti e avviso più voci.
  - [ ] Germe in crescita da `provisionalSeed`, etichettato «provvisorio».
  - [ ] Cartellino e legenda viva con misure grezze e percentili.
  - [ ] Navigazione completa da tastiera; stati annunciati via `aria-live`; `prefers-reduced-motion` rispettato; contrasto AA.
  - [ ] Stringhe in `ui/strings.it.ts`.
  - [ ] Tratti velati nel cartellino. Quando il velo non ha un elemento da attenuare (`veilIsVisible` di `renderer-three` è falso: nessun secondario per p3, nessuna inclusione per p4, una sola banda per p6), lo segnala solo il cartellino, per esempio «ruvidità: incerta (nessuna inclusione da mostrare)». Il rendering non inventa elementi (decisione del product owner, 2026-11-10).
  - [ ] Profilo della vetrina scelto da `chooseProfile` (funzione pura in `renderer-three/src/pure`): economy con GPU software (SwiftShader, llvmpipe), se il contesto con `failIfMajorPerformanceCaveat` non si crea, o se il costo dei primi frame supera una soglia [H] fissata dalla misura M17. Opzione utente «Resa semplificata» che forza economy, ricordata fra le sessioni. Il nome della GPU si legge solo in memoria, mai salvato né trasmesso (decisione del product owner, 2026-11-10).
- **Test:** Playwright sulle schermate; axe-core senza violazioni serie.

### I-14 · Vault, miniature, export/import

- **Riferimenti:** SPEC §12; VC-18, VC-20.
- **DoD:**
  - [ ] Schema v1 con migrazioni testate (da v1 a v1 vuota, struttura pronta per v2).
  - [ ] Import ostile rifiutato: prototipi, HTML, stringhe enormi, file > 20 MB, versioni sconosciute.
  - [ ] `QuotaExceededError` simulato: nessun record esistente perso.
  - [ ] 1.000 record sotto 50 MB [H]; `geometryHash` verificato all'apertura.
  - [ ] Avviso dati personali all'export se presenti `speakerLabel`.
  - [ ] `PRIVACY.md` §3 coerente con ciò che il vault salva davvero e dove (IndexedDB, non `chrome.storage`; miniatura secondo l'ADR di G0-TECH-01). Decisione del product owner D-AK, 2026-11-14. Da I-13b: `PRIVACY.md` dovrà citare anche la preferenza «Resa semplificata» in `chrome.storage.local` (un solo valore vero/falso, nessun dato sulla GPU).
  - [ ] **Eredità da I-18:** il record di un'analisi da file contiene solo l'`AnalysisSource` di tipo `file` (`fileName`, `durationSeconds`, `offsetStartSeconds`, `offsetEndSeconds`): nessun contenuto del file, nessun digest del segnale. Il nome è testo non fidato, da validare in scrittura e in import (R17). Test sul record salvato.
  - [ ] `exportCrystalPng(handle, 1024)` in `renderer-three` (SPEC §10, ADR-0012): PNG 1024×1024 con camera ortografica e preset fissi, `dispose` verificato anche sul render target dell'export. Nessuna promessa di PNG identici fra GPU: l'export canonico resta la tavola SVG (ADR-0013). Assegnato a I-14 dal product owner il 2026-11-10.
  - [ ] Geometrie da record importati passano dal controllo di budget di `renderer-three` (`checkBudget`, errore `BUDGET_EXCEEDED`).
- **Test:** unit con `fake-indexeddb`; E2E export/import.

### I-15 · Comparator a percentile, Collezione, Confronto

- **Riferimenti:** SPEC §11, §13; ADR-0007; VC-06, VC-22.
- **DoD:**
  - [ ] Proprietà matematiche del comparator (identità, simmetria, limiti, monotonia) in property test.
  - [ ] Confronto bloccato per `mappingVersion` o `extractorVersion` diverse, con spiegazione.
  - [ ] Collezione a tutta scheda con filtri; confronto sullo stesso piatto e stessa scala.
  - [ ] Nessun testo che suggerisca identità o «stessa persona».

## Fase 5 — Distribuzione

### I-16 · Hardening, accessibilità, SBOM, pacchetto

- **DoD:**
  - [ ] Esito G0 applicato (sorgenti abilitate, permessi conseguenti).
  - [ ] SBOM e file di attribuzione delle licenze; font OFL inclusi.
  - [ ] Informativa privacy coerente con il comportamento reale.
  - [ ] Verifica manuale completa in Chrome stabile su Windows, macOS, Linux.
  - [ ] Revisione avversariale di release con verdetto GO.
