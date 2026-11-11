# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni [SemVer](https://semver.org/lang/it/). Le versioni semantiche dei dati (`extractorVersion`, `mappingVersion`, `geometryVersion`, `comparatorVersion`, `schemaVersion`) si annotano accanto alla voce che le cambia.

## [Unreleased]

### Aggiunto
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

### Modificato
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
