# VoiceCrystal — Specifica tecnica di sviluppo

**Versione:** 0.3.0 — baseline approvata dopo revisione avversariale  
**Data:** 9 novembre 2026  
**Stato:** APPROVATA PER LE FASI 1–3 (PoC). Fasi 4–5 subordinate ai gate G0, G1, G2 (`docs/GATES.md`)  
**Destinatario:** agente di programmazione e agente revisore indipendente  
**Ambito:** estensione Chrome Manifest V3, DSP vocale, generazione procedurale 3D, IndexedDB  
**Lingua delle interfacce:** italiano (predisposizione i18n, non nel primo MVP)  
**Sostituisce:** `docs/archive/SPEC_v0.2.md`

> **ISTRUZIONE PRIORITARIA PER L'AGENTE:** la revisione avversariale (§17) è stata eseguita e le decisioni D1–D5 sono state accettate dal product owner. Questo documento autorizza lo sviluppo delle issue del backlog (`docs/BACKLOG.md`) nell'ordine delle dipendenze, una issue alla volta. Se un requisito è contraddittorio o impossibile, fermati, segnalalo e proponi una correzione verificabile tramite ADR, senza sostituirlo silenziosamente con una tua interpretazione. Non attribuire mai risultati sperimentali a test non eseguiti.

## Registro delle modifiche rispetto alla v0.2

| Δ | Sezione | Modifica | Rilievo / decisione |
|---|---|---|---|
| Δ1 | §2, §4, §5 | Seconda sorgente «La tua voce» (microfono, file locale) con lo stesso DSP | D1 |
| Δ2 | §3, §16 | G0 obbligatorio prima della fase 4 | VC-01 |
| Δ3 | §5 | Offscreen con motivi `USER_MEDIA`, `WORKERS`; vietato `AUDIO_PLAYBACK` | VC-03 |
| Δ4 | §5 | `sidePanel.open()` sincrono in `action.onClicked`; nessun `setPanelBehavior` | VC-02 |
| Δ5 | §5 | Permesso `storage` necessario per `chrome.storage.session` | VC-16 |
| Δ6 | §5, §14 | Watchdog di sessione (heartbeat 1 Hz, stop dopo 3 s) e codice `NAVIGATED_AWAY` | VC-04 |
| Δ7 | §6 | Macchina di cattura separata dalla macchina della vista UI | VC-14 |
| Δ8 | §6 | Timeout assoluto 120 s | VC-21 |
| Δ9 | §6 | Interruzioni pubblicitarie solo da eventi media standard | VC-09 |
| Δ10 | §7.4 | Definizioni `EXPERIMENTAL v0` dei sei descrittori | Ambiguità 5 |
| Δ11 | §7.5 | Mappa per quantili (CDF) versionata | VC-06, VC-13 |
| Δ12 | §7.5 | Seed come interi 0–10.000, half-even; confidenza per parametro | Ambiguità 7, D3 |
| Δ13 | §8 | Arresto per stabilità split-half | VC-07 |
| Δ14 | §9 | Contratti completati: versioni, confidenza, warning tipizzati, `seq` ovunque | VC-17 |
| Δ15 | §10 | Abito cristallino da intersezione di semispazi, cammino continuo 3 → 6 → 12 facce | VC-05, VC-15, D2 |
| Δ16 | §10 | Hash su vertici quantizzati; trigonometria deterministica nel core | VC-08 |
| Δ17 | §11 | Affinità presentata come percentile sulle coppie di riferimento | VC-06, D5 |
| Δ18 | §12 | Niente PNG nel record: miniatura WebP 256 px; export JSON senza immagini | VC-18 |
| Δ19 | §7.2, §13 | Avviso più voci con conferma dell'utente | VC-12, D4 |
| Δ20 | §13 | Fallback senza WebGL: tavola cristallografica SVG; Collezione a tutta scheda | VC-22, ambiguità 13 |
| Δ21 | §7.4 e seguenti | Chiavi dei descrittori rinominate per ciò che misurano (`p1_pitch` … `p6_rhythm`), separate dalla resa visiva | Chiarezza contratti |

Gli identificativi `VC-xx` rimandano al registro dei rilievi della revisione avversariale (`docs/ADVERSARIAL_REVIEW.md`). Gli `ADR-xxxx` rimandano a `docs/ADR/`.

## Legenda delle decisioni

- **[F] Fissato:** scelta normativa per l'MVP, salvo evidenze contrarie nella revisione.
- **[H] Ipotesi da calibrare:** default implementabile nella proof of concept; non è una soglia scientificamente validata.
- **[G] Gate:** condizione di avanzamento obbligatoria.
- **[P] Post-MVP:** funzione esplicitamente esclusa dal primo rilascio.
- **[R] Rischio residuo:** problema che l'architettura non è in grado di eliminare con garanzia assoluta.

## 1. Intento del prodotto e promessa corretta

**Obiettivo:** trasformare un segmento di parlato (riprodotto su YouTube oppure proveniente dal microfono o da un file dell'utente) in un cristallo tridimensionale generato deterministicamente da sei descrittori acustici normalizzati. Consentire raccolta locale, esportazione e confronto fra cristalli.

**Promessa dell'MVP:** «Ogni cristallo è una visualizzazione riproducibile delle proprietà acustiche misurate in un segmento di parlato».

**Non promettere:** identità biometrica, riconoscimento del parlante, classificazione delle emozioni, isolamento perfetto della voce dalla musica, saturazione scientifica universale, immagine pixel-identica su qualsiasi GPU.

**Priorità:** (1) affidabilità e trasparenza della cattura, (2) coerenza matematica dei seed, (3) differenziazione visiva informativa, (4) esperienza estetica, (5) funzioni di collezione.

**Principio estetico [F]:** mineralogia digitale: cristalli credibili, silhouette leggibile, riflessi controllati, interfaccia sobria da collezione museale. La bellezza non può sostituire la tracciabilità dei parametri.

**Credibilità cristallografica [F] (D2):** gli assi di simmetria rotazionale ammessi sono solo 2, 3, 4 e 6, come nei cristalli periodici reali. Le forme a 12 facce sono ammesse solo come prismi diesagonali (asse 6). Nessun prisma a 5, 7, 9, 10 o 11 lati.

**Continuità [F]:** a una piccola variazione di un parametro corrisponde una piccola variazione visiva. Le facce emergono crescendo da dimensione zero, non compaiono di colpo.

## 2. Confini di prodotto e non-obiettivi

### In scope per l'MVP [F]

- Chrome desktop con `minimum_chrome_version` impostata a `120` (requisito di prodotto conservativo; le API fondamentali sono disponibili già da Chrome 116).
- Due sorgenti audio con lo stesso nucleo DSP/3D (D1):
  - **«Dalla scheda»:** pagine `https://www.youtube.com/watch` con un video on-demand standard.
  - **«La tua voce»:** microfono (`getUserMedia` con consenso esplicito del browser) oppure file audio locale scelto dall'utente (WAV, FLAC, MP3, Ogg/Opus, M4A/AAC se decodificabili da `decodeAudioData`).
- **Una sola cattura attiva per profilo**, qualunque sia la sorgente.
- Avvio esplicito: azione dell'estensione nella toolbar (sorgente scheda) o pulsanti nel pannello (microfono, file). Pannello laterale per ascolto e rivelazione; pagina Collezione a tutta scheda per archivio e confronto.
- Audio analizzato localmente e cancellato dalla memoria alla chiusura della sessione. Persistenza solo di seed, confidenze, misure grezze scalari, metadati, indicatori di qualità, versioni e miniatura WebP.
- Sei parametri in punti `[0,100]`, memorizzati come interi 0–10.000 (§7.5), con versioni di estrattore, mappatura, generatore e comparator.
- Archivio IndexedDB con export/import e cancellazione.
- Analisi su audio PCM locale per test offline, indipendente da YouTube e da Chrome.

### Out of scope [F]/[P]

- Shorts, live stream, video con più parlanti sovrapposti, karaoke/canzoni, contenuti prevalentemente musicali: **non supportati garantitamente**. Parlanti alternati (interviste, podcast) sono rilevati in modo euristico e richiedono conferma dell'utente (D4, §7.2).
- Riconoscimento delle persone, voiceprint biometrico, separazione delle sorgenti mediante reti neurali pesanti, diarizzazione robusta multi-speaker [P].
- Backend, cloud sync, account, analytics remota, registrazione persistente di audio, download di video/audio [F: vietati nell'MVP].
- Estensioni Firefox/Safari/Edge: da valutare dopo Chrome [P].
- Generazione generica da qualunque media web, composizioni musicali, sentiment analysis [P].
- Confronto avanzato delle mesh tramite Hausdorff/Chamfer come metrica ufficiale [P].

## 3. Vincolo legale e distribuzione [G0]

Il fatto che un'API del browser permetta di acquisire l'audio di una scheda **non dimostra** che ogni uso sia permesso dalle condizioni della piattaforma o dai diritti sul contenuto. I termini di YouTube prevedono restrizioni sull'uso dei contenuti; le regole aggiuntive dei servizi API non si applicano automaticamente in egual modo a un'estensione che non utilizza quelle API.

**Decisione [F]:** non utilizzare YouTube Data API; non scaricare né memorizzare media; non bypassare DRM, pubblicità, limitazioni geografiche o controlli tecnici; non alterare il flusso del player; limitare i dati a metadati di navigazione e caratteristiche calcolate in memoria.

**Gate [G0]:** prima di iniziare la fase 4 (e comunque prima di qualunque distribuzione), ottenere una valutazione documentata delle condizioni YouTube, della disciplina applicabile e delle policy del Chrome Web Store. Se la compatibilità non può essere ragionevolmente sostenuta, **non pubblicare una estensione YouTube**: il nucleo DSP/3D deve rimanere riutilizzabile in una web app che analizza audio fornito dall'utente con titolo legittimo. Questa via alternativa non autorizza alcun aggiramento tecnico.

**Esiti ammessi di G0 [F]:** (a) pubblicare l'estensione con entrambe le sorgenti; (b) pubblicare l'estensione con la sola sorgente «La tua voce» (la sorgente «Dalla scheda» resta disattivata a build time tramite flag `VC_SOURCE_TAB=false` e il permesso `tabCapture` viene rimosso dal manifest); (c) pubblicare una web app con il solo nucleo. La checklist è in `docs/LEGAL_G0_CHECKLIST.md`.

## 4. Stack e organizzazione dei moduli

**Stack [F]:** TypeScript `strict`, ES Modules, Vite/Rollup con build multi-entry MV3, Three.js, Tailwind CSS compilato localmente (nessuna CDN), IndexedDB nativo tramite adapter con migrazioni, Vitest per test unitari, Playwright per la UI e script di test E2E dell'estensione. DSP in TypeScript/JavaScript; modulo VAD locale preferibilmente WebAssembly, soggetto a licenza e verifica MV3.

**Perché TypeScript:** i contratti tipizzati, l'identità delle versioni e gli stati di cattura riducono gli errori di integrazione rispetto a JavaScript non tipizzato. Il bundle finale rimane JavaScript.

**Organizzazione consigliata:**

```text
voicecrystal/
  AGENTS.md  CLAUDE.md  README.md  CONTRIBUTING.md
  docs/
    SPEC_v0.3.md
    ADR/
    BACKLOG.md  GATES.md  RISK_REGISTER.md
    BENCHMARK_PROTOCOL.md  LEGAL_G0_CHECKLIST.md
    ADVERSARIAL_REVIEW.md  GLOSSARY.md  STATUS.md
    gates/  reports/  archive/SPEC_v0.2.md
  extension/
    manifest.json
    src/
      background/service-worker.ts
      background/session-store.ts      # chrome.storage.session, nessuno stato autorevole
      content/youtube-adapter.ts       # metadati, eventi media, heartbeat
      offscreen/offscreen.html
      offscreen/audio-session.ts       # stream, pass-through, watchdog
      offscreen/sources/tab-source.ts  # tabCapture (flag VC_SOURCE_TAB)
      offscreen/sources/mic-source.ts  # getUserMedia microfono
      offscreen/pcm-processor.ts       # AudioWorklet: sola acquisizione/accumulo
      offscreen/dsp-worker.ts          # elaborazione non realtime
      sidepanel/index.html
      sidepanel/app.ts
      collection/index.html            # Collezione e confronto a tutta scheda
      collection/app.ts
      permission/index.html            # prima autorizzazione del microfono
      ui/components/
  packages/
    contracts/                       # tipi, messaggi, schemi, versioni
    dsp-core/                        # zero dipendenze Chrome/DOM
    calibration/                     # tabelle quantili versionate (JSON) + loader
    crystal-core/                    # funzione pura, no Three.js nel core
    renderer-three/                  # vetrina WebGL
    renderer-svg/                    # tavola cristallografica deterministica
    comparator/
    vault/
  tests/
    fixtures/pcm/
    fixtures/seeds/
    unit/
    integration/
    e2e/
    benchmarks/
  scripts/
    fixtures/                        # generazione fixture sintetiche
    golden/                          # generazione seed dorati
    review/                          # simulazioni della revisione
  package.json
  tsconfig.json
```

**Regola dei confini [F]:** `dsp-core`, `calibration`, `crystal-core`, `renderer-svg` e `comparator` sono librerie pure senza API Chrome né DOM, eseguibili in Node. `audio-session` gestisce stream e clock. `renderer-three` crea/dispone risorse WebGL. `vault` è l'unico livello che accede a IndexedDB. `youtube-adapter` legge metadati/controlli del video e non processa audio.

## 5. Architettura MV3 e permessi

### Componenti e responsabilità [F]

1. **Content Script, isolated world:** opzionale elemento UI non invasivo; lettura sicura di `videoId`, `currentTime`, `paused`, `playbackRate`, eventi `seeking`, `seeked`, `play`, `pause`, cambio video SPA. Nessun accesso a variabili interne non documentate di YouTube.
2. **Service Worker:** gestisce `chrome.action.onClicked`, autorizzazione tab, apertura/gestione dell'offscreen document, routing dei messaggi, collisioni tra catture. Nessun AudioContext, FFT, accumulo lungo o stato RAM autorevole. Il minimo stato di instradamento (`sessionId`, `tabId`, sorgente) vive in `chrome.storage.session` e viene riletto a ogni risveglio (Δ5).
3. **Offscreen Document:** `getUserMedia` con stream ID di tabCapture **oppure** con microfono, `AudioContext`, playback pass-through (solo sorgente scheda), `AudioWorklet`, DSP worker, watchdog e stato runtime autorevole della cattura. La documentazione limita le API estensione accessibili dall'offscreen document a `chrome.runtime`.
4. **Side Panel:** home, ascolto, rivelazione, cartellino, ultimi esemplari; avvio di microfono e file; invocazioni tramite messaggi; renderer Three.js.
5. **Pagina di permesso** (`permission.html`, scheda dedicata): ottiene la prima autorizzazione al microfono.
6. **Pagina Collezione** (`collection.html`, scheda dedicata): griglia dell'archivio, filtri, confronto affiancato. La Side Panel è troppo stretta per queste viste (VC-22).
7. **Decodifica file locale:** nella Side Panel tramite `<input type="file">` e `decodeAudioData`; il PCM decodificato entra nello stesso `dsp-worker` come se fosse uno stream, senza pass-through.
8. **IndexedDB:** storage nell'origine dell'estensione, mai nello storage della pagina YouTube.

### Permessi di partenza [F]

```json
{
  "manifest_version": 3,
  "name": "VoiceCrystal",
  "version": "0.3.0",
  "minimum_chrome_version": "120",
  "permissions": ["tabCapture", "offscreen", "sidePanel", "activeTab", "storage"],
  "action": { "default_title": "Avvia VoiceCrystal" },
  "background": { "service_worker": "background.js", "type": "module" },
  "side_panel": { "default_path": "sidepanel.html" },
  "content_scripts": [{
    "matches": ["https://www.youtube.com/watch*"],
    "js": ["youtube-content.js"],
    "run_at": "document_idle"
  }],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```

**Nota:** manifest **schematico** da compilare/validare; i file finali devono esistere nel bundle. Nessun permesso generale `https://*/*`; verificare la compatibilità del match pattern con le URL reali. `storage` è **necessario** (Δ5): serve a `chrome.storage.session` per lo stato minimo di instradamento e a `chrome.storage.local` per le preferenze; IndexedDB non lo richiede. Nessun `desktopCapture`. Nessun permesso `tabs` salvo che I-03 dimostri che l'URL della scheda non è leggibile altrimenti (ADR obbligatorio).

**Microfono (sorgente «La tua voce»):** non esiste un permesso di manifest per il microfono; l'autorizzazione è quella del browser per l'origine dell'estensione. Un offscreen document non può mostrare la richiesta di permesso: la prima autorizzazione si ottiene in una pagina visibile dell'estensione (`permission.html`, aperta in scheda dal pannello), poi l'offscreen usa il microfono con lo stesso permesso. Comportamento `needs current-doc verification` in I-17.

### Avvio e mantenimento della cattura [F]

Sequenza normativa:

```text
Utente clicca icona estensione (Chrome action)
  → SW, come PRIMA istruzione sincrona: chrome.sidePanel.open({ tabId })   // nessun await prima
  → SW controlla tabId, URL, assenza di altra sessione
  → SW assicura offscreen document (createDocument reasons: USER_MEDIA, WORKERS; MAI AUDIO_PLAYBACK)
  → SW ottiene tabCapture.getMediaStreamId({ targetTabId: tabId })      // solo dopo che l'offscreen esiste
  → SW invia subito l'ID una sola volta all'offscreen document
  → offscreen getUserMedia({audio: chromeMediaSource:'tab', chromeMediaSourceId:ID, video:false})
  → offscreen AudioContext: stream source → destination (ascolto utente)
  → ramo analisi → AudioWorklet → DSP worker (nessun doppio audio)
  → session started / audio confirmed / metadata synced
  → raccolta → risultato → stop tracks / close context / release resources
```

**Vincoli cruciali:** lo stream ID è monouso e scade dopo pochi secondi; non deve essere salvato né messo in coda. Prevedere timeout, tentativi limitati e avviso esplicito in caso di errore. La cattura della scheda può silenziare l'audio normalmente riprodotto: è obbligatorio un percorso di playback verso `AudioContext.destination`. Testare che l'uscita audio non sia duplicata, distorta o interrotta. Chrome può terminare il service worker: lo stato di cattura non deve dipendere da variabili globali del worker.

**Perché quest'ordine [F] (Δ3, Δ4):** `sidePanel.open()` funziona solo in risposta a un gesto dell'utente e fallisce se chiamato dopo un `await`. Non si usa `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, perché è segnalato che impedisce la ricezione di `action.onClicked`. Il motivo `AUDIO_PLAYBACK` chiude l'offscreen dopo 30 s senza audio (video in pausa); gli altri motivi non hanno limiti di durata. Dettagli in ADR-0002 e ADR-0003.

**Watchdog di sessione [F] (Δ6):** la cattura `tabCapture` sopravvive alle navigazioni nella stessa scheda. Quindi:

1. il content script invia `HEARTBEAT { sessionId, videoId, url }` ogni 1 s finché la pagina è un `/watch`;
2. l'offscreen chiude la sessione con `INTERRUPTED / NAVIGATED_AWAY` se non riceve heartbeat per 3 s o se `url` non corrisponde più a `/watch` o `videoId` cambia;
3. il SW inoltra anche `tabs.onRemoved` e, se leggibile, il cambio URL di `tabs.onUpdated` come segnali aggiuntivi, mai come unica difesa;
4. `tabCapture.onStatusChanged` con stato `stopped` o `error` chiude la sessione.

**UX di autorizzazione:** il pulsante dentro YouTube, se presente, apre solo istruzioni; **non avvia la cattura**. Il click sulla action della toolbar è l'unico avvio della sorgente «Dalla scheda». Le sorgenti microfono e file si avviano da pulsanti nella Side Panel.

**Una cattura globale [F]:** una sola sessione per profilo, per evitare conflitto fra offscreen singleton, sorgente audio e stato dei browser tabs. Una seconda richiesta riceve `CAPTURE_BUSY` con opzione per interrompere la prima.

**Action su pagina non supportata [F]:** se la scheda non è un `/watch` di YouTube, il click apre comunque la Side Panel ma non avvia alcuna cattura; il pannello propone le sorgenti microfono e file e spiega perché la scheda non è supportata (`NOT_YOUTUBE_WATCH`).

## 6. Macchine a stati e modello temporale

Due macchine separate (Δ7, ADR-0011): la **macchina di cattura**, autorevole nell'offscreen, e la **macchina della vista**, nella UI. Il salvataggio e il confronto appartengono alla vista, non alla cattura.

### 6.1 Macchina di cattura (normativa)

```text
IDLE
  └─ START(source) → AUTHORIZING
AUTHORIZING
  ├─ acquired → LISTENING
  └─ denied | timeout | stream id expired → ERROR
LISTENING
  ├─ VAD pause → WAITING_FOR_SPEECH
  ├─ player paused → PAUSED                         (solo sorgente scheda)
  ├─ split-half stable (§8) → FINALIZING
  ├─ valid speech = 18 s → FINALIZING
  ├─ active time = 45 s → FINALIZING
  ├─ seek | video changed | rate ≠ 1 | ad suspected | navigated away | user stop → INTERRUPTED
  └─ stream ended | capture error | offscreen closed → ERROR
WAITING_FOR_SPEECH
  ├─ voice resumes → LISTENING
  ├─ player paused → PAUSED
  ├─ active time = 45 s → FINALIZING
  └─ (stesse uscite INTERRUPTED / ERROR di LISTENING)
PAUSED
  ├─ player resumes → LISTENING
  ├─ absolute time = 120 s → FINALIZING
  └─ (stesse uscite INTERRUPTED / ERROR di LISTENING)
FINALIZING
  ├─ quality accepted → RESULT_READY
  └─ quality rejected → INSUFFICIENT_DATA
RESULT_READY | INSUFFICIENT_DATA | INTERRUPTED | ERROR      (terminali)
  └─ risorse rilasciate, messaggio finale emesso → IDLE
```

`FINALIZING` con meno di 8 s di voce valida porta sempre a `INSUFFICIENT_DATA`.

### 6.2 Macchina della vista (UI)

```text
HOME ─ start ─▶ LIVE (riflette la cattura) ─ RESULT_READY ─▶ REVEALED
REVEALED ─ save ─▶ SAVED ─▶ HOME | COLLECTION
REVEALED ─ discard ─▶ HOME
LIVE ─ INSUFFICIENT_DATA | INTERRUPTED | ERROR ─▶ OUTCOME (messaggio + azioni) ─▶ HOME
COLLECTION ─ select A,B ─▶ COMPARING ─▶ COLLECTION
```

**Invarianti [F]:** non produrre un `CrystalSeed` ufficiale senza `quality.accepted === true`; `stop()` deve essere idempotente e accettato da ogni stato; ogni chiamata asincrona è associata a `sessionId`; messaggi vecchi o con `seq` non crescente sono ignorati; pulizia di stream, audio nodes e worker in `finally`; chiusura scheda/estensione interrompe la cattura; ogni stato terminale torna a `IDLE` entro 1 s.

**Tempi [H]:** minimo 8 s di parlato valido; massimo 18 s di parlato valido; massimo 45 s di tempo attivo (escluso `PAUSED`); **timeout assoluto 120 s** dall'avvio, comprese le pause (Δ8). Il tempo è misurato su campioni audio, non su conteggi `setInterval`; il tempo assoluto usa `performance.now()` nell'offscreen.

**Pubblicità e cambi di sorgente [F] (Δ9):** nessuna lettura di classi DOM o variabili non documentate del player. Si considerano sospetta interruzione: eventi `emptied`, `loadstart`, `durationchange` dell'elemento `<video>`; cambio di `currentSrc`; salto di `currentTime` di oltre 1 s senza `seeking`. Esito: `INTERRUPTED / AD_OR_SOURCE_CHANGE`. La UI dichiara che alcuni annunci possono non essere riconosciuti.

**Timeline video [F]:** stream audio e metadata timeline non sono intrinsecamente sample-accurate; la sincronizzazione `currentTime` è approssimata e deve essere dichiarata tale. Campionare eventi/timeupdate del video e rilevare salti, variazioni rate e variazione `videoId`. Con `playbackRate !== 1` interrompere/invalidate la sessione per non deformare `f0`; con `seeking/seeked` interrompere; con `paused` passare a `PAUSED` e congelare l'accumulo; con navigazione SPA o sospetta pubblicità interrompere. Il limite di riconoscimento degli annunci è dichiarato, non simulato. Conservare `timeStartSeconds`, `timeEndSeconds`, `videoId`, `validSpeechSeconds`, `elapsedSeconds` e `timelineQuality`.

## 7. Pipeline DSP: contratto e algoritmi

### 7.1 Acquisizione PCM [F]

- L'audio deve restare in RAM; non usare `MediaRecorder` e non scrivere WAV in IndexedDB.
- `AudioWorkletProcessor` raccoglie blocchi PCM, non esegue FFT costose o attività asincrone nel thread audio. Dimensione dei blocchi: **non assumere hardcode 128**; leggere la lunghezza del buffer ricevuto.
- Convertire stereo in mono con regole documentate e testate; verificare casi con canali fuori fase (regola: ADR-0016). Conservare `sourceSampleRate`, `analysisSampleRate`, `channelCount` e indicazioni clipping.
- Resampling deterministico con filtro anti-alias prima del VAD (target 16 kHz); il DSP per centroide/pitch può utilizzare una frequenza diversa se motivata e testata.
- `dsp-worker` processa in batch brevi; usare coda limitata e segnalare `PROCESSING_OVERRUN` quando la CPU non tiene il passo. Niente drop di frame non contabilizzati.
- L'ordine dei frame e i rispettivi campioni audio, non l'ordine di arrivo dei messaggi, determina le statistiche.

### 7.2 VAD e qualità [F]

- VAD locale a frame di 20 ms a 16 kHz, preferibilmente un'implementazione WebRTC con licenza e packaging verificati; il filtro `RMS + 85–3400 Hz` è ammesso **solo** come pre-filtro e diagnostica, non come VAD principale.
- Il VAD identifica probabilmente il parlato, **non** certifica l'assenza di musica né l'identità del parlante.
- Scartare dal seed frame muti, clip con clipping grave, frame con qualità insufficiente e intervalli non coerenti con il segmento video.
- `voiceConfidence` e `signalQuality` vanno distinti. Se il motore VAD restituisce solo etichetta binaria, non inventare una probabilità: registrare `vadDecision` e qualità del segnale separatamente.
- Per la prima versione utilizzare controlli conservativi su predominanza musicale e voci sovrapposte; se il rilevatore non ha confidenza, segnalare `MIXED_AUDIO_UNCERTAIN`. Non attribuire un'etichetta `singleSpeaker` se non si dispone di diarizzazione.
- **Scelta del VAD [G1]:** WebRTC VAD (libfvad) e Silero VAD vengono confrontati in I-05 sulle stesse fixture; la scelta è registrata in un ADR con licenza, dimensione del bundle e falsi positivi su musica.
- **Euristica musica [H]:** indizi di musica sono altezza stabile entro ±25 cent per oltre 200 ms, energia armonica sostenuta fra le sillabe e flusso spettrale periodico. Se la quota di frame utili con indizi musicali supera il 20%, warning `MIXED_AUDIO_UNCERTAIN`.
- **Euristica più voci [H] (D4, Δ19):** distribuzione di log2(f0) bimodale (coefficiente di bimodalità > 0,555 su almeno 4 s di voce) oppure salti ripetuti del centroide mediano fra blocchi di 1 s. Esito: warning `MULTI_SPEAKER_SUSPECTED`. La UI chiede all'utente «Parla una sola persona in questo tratto?»; se risponde sì il cristallo è valido e porta il warning; se no la sessione termina con `INSUFFICIENT_DATA`.
- **Confidenza per parametro [F] (D3):** ogni descrittore ha `confidence ∈ [0,1]` calcolata dalla quota di frame utilizzabili e dalla presenza di warning pertinenti. Un parametro con confidenza < 0,5 [H] non invalida il cristallo: il tratto visivo corrispondente è reso «velato» e il cartellino lo dichiara. Il cristallo è `INSUFFICIENT_DATA` solo se un descrittore non è calcolabile affatto o se più di due hanno confidenza < 0,5.

### 7.3 Caratteristiche frame-level

Usare finestre con sample rate esplicito, overlap deterministico e finestratura definita. Le FFT sono utilizzabili per il contenuto spettrale; `f0` richiede uno stimatore dedicato (YIN o equivalente con confidenza). Evitare di dedurre pitch dalla sola `fftSize=2048`.

Per ogni frame utile, quando disponibile:

```ts
interface AcousticFrame {
  frameIndex: number;
  sampleStart: number;
  sampleLength: number;
  vadSpeech: boolean;
  rmsDbfs: number | null;
  f0Hz: number | null;
  pitchConfidence: number | null;
  spectralCentroidHz: number | null;
  spectralFlatness: number | null;
  periodicity: number | null;
  envelopeEnergy: number;
  clipped: boolean;
}
```

I `null` significano **non misurabile** e non vengono trasformati implicitamente in zero. Non usare stime fisiche senza controllo su range e confidenza.

### 7.4 Sei descrittori `EXPERIMENTAL v0` [F per la definizione; H per soglie e calibrazione] (Δ10)

I nomi descrivono **cosa si misura**, non come si disegna (Δ21); la resa visiva è nel §10. Definizioni:

- **frame utile:** `vadSpeech === true`, `clipped === false`, `rmsDbfs` non nullo e > −60 dBFS [H];
- **frame intonato:** frame utile con `f0Hz` in [60, 500] Hz e `pitchConfidence ≥ 0,8` [H] (YIN, soglia aperiodicità 0,15).

| Chiave | Nome IT | Misura grezza `x_i` | Minimo per calcolarla [H] |
|---|---|---|---|
| `p1_pitch` | Altezza | mediana di `log2(f0Hz)` sui frame intonati | 2 s di frame intonati |
| `p2_intonation` | Variabilità d'intonazione | scarto interquartile di `12·log2(f0Hz)` (semitoni) sui frame intonati | 2 s di frame intonati |
| `p3_dynamics` | Dinamica | `P90 − P10` di `rmsDbfs` sui frame utili | 4 s di frame utili |
| `p4_roughness` | Ruvidità | mediana di `1 − periodicity` (aperiodicità YIN) sui frame intonati | 2 s di frame intonati |
| `p5_brightness` | Brillantezza | mediana di `log2(centroide 300–4000 Hz)` sui frame utili; da `mapping-1` residuo rispetto alla retta su `log2(f0)` stimata in calibrazione | 4 s di frame utili |
| `p6_rhythm` | Ritmo | onset per secondo di voce valida (picchi del flusso spettrale, distanza minima 80 ms) | 20 onset |

Le formule sono versionate da `extractorVersion` (prima versione: `extractor-0-experimental`). Ogni modifica di formula, finestra o soglia incrementa la versione.

**Avvertenza:** questi sei descrittori sono una rappresentazione artistica di proprietà acustiche, non fattori fisici indipendenti e non una metrica certificata di identità del parlante. Alcuni sono fortemente dipendenti dal contenuto fonetico e dalla catena di registrazione. La calibratura serve a contenere, non a eliminare, tali dipendenze.

### 7.5 Normalizzazione, qualità e seed canonico

**Mappa per quantili [F] (Δ11, ADR-0006):** ogni misura grezza `x_i` è trasformata con la funzione di ripartizione empirica `F_i` della popolazione di calibrazione, interpolata linearmente fra 101 percentili tabulati (P0…P100):

```text
p_i = 100 · F_i(x_i)        con F_i monotona non decrescente, valori fuori range saturati a 0 o 100
```

Così `p_i = 75` significa «più alto del 75% delle voci di riferimento» e le collezioni occupano tutto lo spazio delle forme. Le tabelle stanno in `packages/calibration/<mappingVersion>.json`. Non vengono mai stimate per singola clip. Prima di G1 si usa `mapping-0-experimental`: tabelle lineari fra ancoraggi provvisori (p1: 70–320 Hz in log2; p2: 0–8 semitoni; p3: 6–30 dB; p4: 0,05–0,45; p5: 600–2400 Hz in log2; p6: 2–7 onset/s), marcate `EXPERIMENTAL` anche in UI.

**Regole canoniche [F] (Δ12):** ordine dei parametri immutabile; il seed canonico è una tupla di **sei interi in [0, 10000]** (centesimi di punto), ottenuti con arrotondamento half-even da `100 · p_i`; i decimali esistono solo in visualizzazione. Niente `NaN`, `Infinity`, default a zero per feature mancanti o array di lunghezza variabile. Se un descrittore non è calcolabile, il risultato è `INSUFFICIENT_DATA` (§7.2 per la confidenza).

```ts
type SeedUnits = number; // intero 0..10000, Number.isInteger obbligatorio
type CrystalSeed = readonly [p1_pitch: SeedUnits, p2_intonation: SeedUnits,
                             p3_dynamics: SeedUnits, p4_roughness: SeedUnits,
                             p5_brightness: SeedUnits, p6_rhythm: SeedUnits];
type SeedConfidence = readonly [number, number, number, number, number, number]; // 0..1
```

## 8. Arresto adattivo: non «saturazione spettrale» assoluta

**Terminologia [F]:** `feature_convergence` / «stabilità del campionamento». Il testo UI non deve dichiarare una percentuale scientifica di saturazione di una voce.

Tre condizioni **tutte necessarie** per terminazione anticipata:

1. Durata di parlato valido `>= 8 s` [H].
2. Copertura minima: ogni descrittore ha raggiunto il proprio minimo di calcolo (§7.4); nessun warning `MULTI_SPEAKER_SUSPECTED` in attesa di risposta.
3. **Stabilità split-half** (Δ13, ADR-0008) vera per **tre valutazioni consecutive**, una per ogni secondo di voce valida.

**Stabilità split-half:** la voce valida accumulata è divisa in blocchi consecutivi di 1 s. Ogni descrittore normalizzato è calcolato due volte, sui blocchi pari (`a_i`) e sui blocchi dispari (`b_i`).

```text
s_t = max_i | a_i(t) − b_i(t) |      (in punti 0–100)
stabile se s_t ≤ τ,   τ = 6 punti [H]
```

Il criterio misura la coerenza interna del campione, non l'inerzia di una media cumulativa (VC-07). Costo: due stime aggiuntive al secondo. Nessuna regola di arresto prevede cambiamenti futuri: il limite è dichiarato.

Arresti:

- `CONVERGED` se tutte le condizioni sono vere.
- `MAX_VALID_SPEECH` a 18 s: cristallo consentito soltanto se `quality.accepted=true`, marcato **terminato per limite**, non «saturato».
- `WALL_TIMEOUT` a 45 s di tempo attivo: idem.
- `ABSOLUTE_TIMEOUT` a 120 s dall'avvio, pause comprese: idem.
- `INSUFFICIENT_DATA` se qualità/copertura non superano i criteri.
- `INTERRUPTED` su seek, cambio video, cambio velocità, sospetto annuncio, navigazione fuori pagina, stop utente.

**UI:** mostra `voce utile: X / 18 s` e stato `Raccolta`, `Voce non rilevata`, `In pausa`, `Stabilità raggiunta`, `Qualità insufficiente`. La barra progresso rappresenta il budget di campionamento, non una certezza probabilistica. Durante la raccolta il cristallo provvisorio «in crescita» (§13) usa le stime correnti ed è etichettato come provvisorio.

## 9. Contratti di dati e messaggi

I messaggi tra componenti sono discriminated unions e includono versione protocollo, sessione e numero progressivo. Non trasmettere PCM al service worker o alla UI.

```ts
type SessionId = string;            // UUID v4
type SourceKind = 'tab' | 'mic' | 'file';

type CaptureState =                 // solo macchina di cattura (§6.1)
  | 'IDLE' | 'AUTHORIZING' | 'LISTENING' | 'WAITING_FOR_SPEECH' | 'PAUSED'
  | 'FINALIZING' | 'RESULT_READY'
  | 'INSUFFICIENT_DATA' | 'INTERRUPTED' | 'ERROR';

type CaptureExitReason =
  | 'CONVERGED' | 'MAX_VALID_SPEECH' | 'WALL_TIMEOUT' | 'ABSOLUTE_TIMEOUT'
  | 'USER_STOP' | 'VIDEO_SEEK' | 'VIDEO_CHANGED' | 'PLAYBACK_RATE_CHANGED'
  | 'AD_OR_SOURCE_CHANGE' | 'NAVIGATED_AWAY' | 'MULTI_SPEAKER_DECLINED'
  | 'STREAM_ENDED' | 'OFFSCREEN_CLOSED' | 'QUALITY_REJECTED' | 'CAPTURE_ERROR';

type QualityWarning =
  | 'MIXED_AUDIO_UNCERTAIN' | 'MULTI_SPEAKER_SUSPECTED'
  | 'LOW_CONFIDENCE_PARAMETER' | 'CLIPPING' | 'LOW_LEVEL'
  | 'PLAYER_MUTED' | 'EXPERIMENTAL_MAPPING'
  | 'PHASE_CANCELLATION';                        // ADR-0016

interface Envelope { v: 1; sessionId: SessionId; seq: number } // seq crescente per mittente

type CaptureMessage = Envelope & (
  | { type: 'CAPTURE_START'; source: SourceKind; tabId: number | null }
  | { type: 'CAPTURE_STOP'; reason: 'USER_STOP' }
  | { type: 'HEARTBEAT'; videoId: string; url: string; paused: boolean;
      playbackRate: number; muted: boolean; volume: number }
  | { type: 'MULTI_SPEAKER_ANSWER'; singleSpeaker: boolean }
  | { type: 'CAPTURE_PROGRESS'; state: CaptureState; validSpeechMs: number;
      elapsedMs: number; quality: QualitySummary;
      provisionalSeed: CrystalSeed | null }          // solo per il germe in crescita
  | { type: 'CAPTURE_RESULT'; result: AnalysisResult }
  | { type: 'CAPTURE_FAILED'; code: CaptureErrorCode; exitReason: CaptureExitReason }
);

interface QualitySummary {
  accepted: boolean;
  validSpeechMs: number;
  pitchUsableFrames: number;
  vadSpeechFrames: number;
  droppedFrames: number;
  clippedFraction: number;
  confidence: SeedConfidence;
  missingFeatureKeys: DescriptorKey[];
  warnings: QualityWarning[];
}

type DescriptorKey = 'p1_pitch' | 'p2_intonation' | 'p3_dynamics'
                   | 'p4_roughness' | 'p5_brightness' | 'p6_rhythm';

type CaptureErrorCode =
  | 'NOT_YOUTUBE_WATCH' | 'CAPTURE_BUSY' | 'PERMISSION_DENIED'
  | 'MIC_PERMISSION_REQUIRED' | 'FILE_DECODE_FAILED' | 'FILE_TOO_LONG'
  | 'STREAM_ID_EXPIRED' | 'STREAM_NOT_AVAILABLE' | 'OFFSCREEN_FAILED'
  | 'AUDIO_CONTEXT_FAILED' | 'PROCESSING_OVERRUN'
  | 'PLAYBACK_ROUTING_FAILED' | 'VIDEO_UNSUPPORTED'
  | 'INTERNAL_ERROR';

type AnalysisSource =
  | { kind: 'tab'; platform: 'youtube'; videoId: string; title: string;
      timeStartSeconds: number | null; timeEndSeconds: number | null;
      timelineQuality: 'estimated' | 'unknown'; playbackRate: 1 }
  | { kind: 'mic' }
  | { kind: 'file'; fileName: string; durationSeconds: number;
      offsetStartSeconds: number; offsetEndSeconds: number };

interface AnalysisResult {
  seed: CrystalSeed;
  confidence: SeedConfidence;
  rawMeasures: readonly [number, number, number, number, number, number]; // x_i, per la legenda viva
  extractorVersion: string;
  mappingVersion: string;
  geometryVersion: string;          // generatore con cui la UI lo mostrerà
  comparatorVersion: string;
  exitReason: CaptureExitReason;
  quality: QualitySummary;
  source: AnalysisSource;
}
```

**File locali [H]:** si analizzano al massimo i primi 120 s di audio decodificato (`FILE_TOO_LONG` oltre 30 minuti di durata totale); l'utente può scegliere il punto di partenza. Il PCM decodificato resta in memoria solo per la durata dell'analisi.

**Contratto di errore:** `CAPTURE_FAILED` non equivale a un risultato incompleto valido. `CAPTURE_RESULT` deve essere emesso una sola volta e solo dopo la pulizia della sessione audio. Per eventi inattesi, log locale di errore senza audio o stream ID. Sanitizzare `title` e dati importati come testo, non come HTML.

## 10. Generatore di cristalli: determinismo verificabile

### Interfacce normative [F]

```ts
interface FacePlane { normal: readonly [number, number, number]; distance: number; form: string }

interface CrystalBody {
  kind: 'primary' | 'secondary';
  planes: readonly FacePlane[];          // definizione: intersezione di semispazi
  positions: Int32Array;                 // xyz quantizzati, unità = 2^-16
  indices: Uint32Array;                  // triangoli, ordine canonico, winding CCW esterno
  faceOfTriangle: Uint16Array;           // indice del piano-faccia di ogni triangolo
}

interface CrystalGeometry {
  geometryVersion: string;               // es. 'habit-1'
  habitName: string;                     // es. 'prisma diesagonale', per il cartellino
  bodies: readonly CrystalBody[];        // [0] = primario
  inclusions: readonly { kind: 'needle' | 'phantom'; transform: readonly number[] }[]; // 4x4, quantizzate
  appearance: {                          // fuori dall'hash geometrico
    colorOklch: readonly [number, number, number];
    zoningBands: number;                 // da p6
    veiledTraits: readonly DescriptorKey[]; // confidenza < 0,5
  };
  geometryHash: string;                  // SHA-256 di bodies + inclusions canonici
}

function generateCrystalGeometry(seed: CrystalSeed, confidence: SeedConfidence,
                                 geometryVersion: string): CrystalGeometry;   // pura
function renderCrystal(geometry: CrystalGeometry, config: RenderConfig): RenderHandle;  // WebGL
function renderPlateSvg(geometry: CrystalGeometry, view: PlateView): string;            // pura, deterministica
function exportCrystalPng(handle: RenderHandle, resolution: number): Promise<Blob>;
```

**Nota:** lo schema viene congelato al gate [G2]. Il rendering WebGL non è parte della funzione pura; `renderPlateSvg` sì.

### Costruzione: intersezione di semispazi [F] (Δ15, ADR-0005)

Ogni corpo cristallino è l'intersezione dei semispazi `n·x ≤ d` dei suoi piani-faccia (principio della costruzione di Wulff). Il risultato è sempre convesso, chiuso e privo di auto-intersezioni. Le facce visibili dipendono solo dalle distanze `d`: una faccia lontana non tocca il solido; avvicinandosi emerge come smusso infinitesimo e cresce. Niente CSG.

**Forme ammesse [F] (D2):** sistema esagonale/trigonale per il prisma (trigonale, ditrigonale, esagonale, diesagonale), terminazioni piramidali e romboedriche, pinacoide. Assi di simmetria solo 2, 3, 4, 6.

### Mapping geometrico [F nella struttura; H nelle costanti]

| Descrittore | Grandezza cristallografica | Natura |
|---|---|---|
| `p1_pitch` | Cammino continuo delle distanze dei prismi: trigonale (3) → ditrigonale (6, asse 3) → esagonale (6) → esagonale smussato → diesagonale (12) | Continua |
| `p2_intonation` | Ripidità e numero delle facce di terminazione (piramidi, romboedri, pinacoide) | Continua |
| `p3_dynamics` | Allungamento c/a del primario; dimensione dei cristalli secondari, che nascono da dimensione 0 | Continua |
| `p4_roughness` | Densità e lunghezza delle inclusioni aghiformi e dei fantasmi interni | Continua |
| `p5_brightness` | Colore lungo un percorso OKLCH monotono rubino → ambra → ciano → zaffiro | Aspetto, fuori dall'hash |
| `p6_rhythm` | Numero e contrasto delle bande di zonatura di crescita interne | Aspetto, fuori dall'hash |

> **Nota (ADR-0019):** in `habit-1` il cammino di `p1` combina prismi del primo e del secondo ordine, con angoli solo di 120° e 150°. Per questo i cartellini dicono «prisma trigonale smussato» al posto di «ditrigonale» e «prisma esagonale doppio» al posto di «diesagonale», anche negli esempi di questa specifica. I prismi ditrigonale e diesagonale veri sono previsti in una versione futura della geometria.

**Proprietà di continuità [F]:** per ogni coppia di seed che differiscono di al più 100 unità (1 punto) in un solo parametro, la differenza di silhouette (1 − IoU delle proiezioni ortografiche frontale e superiore) è ≤ 0,03 [H]. È un test property-based obbligatorio in `crystal-core`.

**Determinismo [F] (Δ16, ADR-0010):** PRNG `xoshiro128**` seedato dai primi 128 bit di SHA-256 della serializzazione canonica `(seed, geometryVersion, domainLabel)`. Domini separati (`secondary`, `inclusions`, `orientation`): aggiungere una chiamata in un dominio non perturba gli altri. **Nota (ADR-0018):** per rispettare la proprietà di continuità, il PRNG si seeda con i nodi di un reticolo dei parametri geometrici p1…p4 al posto del seed intero, e i valori si interpolano con continuità. Vietati `Math.random`, `Date`, clock, stato globale, risorse GPU. Nel percorso che produce vertici sono vietate `Math.sin`, `Math.cos`, `Math.tan`, `Math.exp`, `Math.pow`, `Math.log` e simili (approssimate dall'implementazione): si usano tabelle precalcolate versionate o polinomi deterministici del core. Tutti i vertici sono quantizzati a interi in unità 2⁻¹⁶ prima di triangolare e calcolare l'hash. Le normali si ricalcolano nel renderer.

**Portabilità:** l'hash deve coincidere in Node, Chrome e Firefox sui seed dorati (test I-10). La rasterizzazione WebGL non promette PNG identici tra GPU/driver/browser; la tavola SVG sì, a parità di `geometryVersion` e `PlateView`.

**Qualità e robustezza:** mesh con winding coerente, assenza di NaN/Inf, limiti su numero triangoli e memoria, `dispose()` esplicito di geometrie/materiali/texture/render target; gestione `webglcontextlost`. Una modalità renderer «economy» non cambia il seed né la mesh primaria.

**Profilo visivo «vetrina» [H] (ADR-0012):** fondo scuro neutro; ambiente procedurale (`RoomEnvironment` + PMREM, nessun HDR esterno); una luce chiave e ombra di contatto morbida; `MeshPhysicalMaterial` con trasmissione, IOR, spessore e colore di attenuazione (dispersione e tone mapping AgX/Neutral solo se presenti nella release Three.js fissata: `needs current-doc verification`); piatto girevole lento; camera ortografica per l'export. Modalità «economy» con materiali standard su GPU deboli: non cambia seed né mesh. PNG 1024×1024 con preset fissi. Le immagini sono output estetici e non dati scientifici.

**Tratti velati (D3):** per ogni descrittore in `appearance.veiledTraits` il renderer attenua il tratto corrispondente (es. inclusioni sfocate, bande a basso contrasto) e il cartellino lo segnala.

**Tavola cristallografica SVG [F] (ADR-0013):** proiezione ortografica a linee del corpo primario. Per un convesso uno spigolo è visibile se almeno una delle due facce adiacenti è rivolta verso l'osservatore; gli spigoli nascosti sono tratteggiati. Coordinate arrotondate a 0,01 px, nessun float non deterministico nell'output: lo stesso input produce lo stesso SVG byte per byte. È l'export canonico e il fallback senza WebGL.

## 11. Comparator: affinità acustica, non probabilità d'identità

**Algoritmo MVP [F]:** distanza euclidea pesata tra seed della **stessa mappingVersion**.

```text
D(A,B) = sqrt( sum_{i=1..6} w_i * ((A_i - B_i) / 100)^2 )
Affinity(A,B) = 100 * clamp(1 - D(A,B), 0, 1)
w_i >= 0, sum_i w_i = 1
```

Pesi iniziali [H]: `w_i = 1/6` per ogni parametro. Qualunque peso alternativo deve avere `comparatorVersion` esplicita e motivazione sperimentale.

**Presentazione all'utente [F] (Δ17, D5, ADR-0007):** la percentuale `Affinity` **non** viene mostrata come numero principale, perché per due voci qualunque vale in media circa 60–80% (simulazione della revisione, VC-06). Si mostra il **percentile di vicinanza**:

```text
Vicinanza(A,B) = 100 · (1 − G(D(A,B)))
G = funzione di ripartizione empirica di D sulle coppie di parlanti diversi del dataset di riferimento
```

Testo UI: «Più vicini del N% delle coppie di voci diverse di riferimento». Prima di G1 `G` deriva da seed uniformi indipendenti e la UI mostra «stima sperimentale». La tabella di `G` è parte di `comparatorVersion`. `Affinity` e i sei contributi `w_i·((A_i − B_i)/100)²` restano visibili nei dettagli.

**Invarianti matematiche:** simmetria; identità `Affinity(A,A)=100`; estremi opposti 0 e 100 su tutte le dimensioni con pesi positivi -> 0; valori finiti e sempre `[0,100]`; monotonia rispetto all'aumento della differenza assoluta in una singola componente, a parità di altre componenti. Vietato interpretare la percentuale come «probabilità che sia la stessa persona».

**Compatibilità:** confronto bloccato se `mappingVersion` diversa o seed malformati, salvo migrazione esplicitamente definita e verificata. `extractorVersion` diversa richiede almeno avviso e una policy di compatibilità documentata; default conservativo: blocco quando la semantica delle feature cambia. `geometryVersion` diversa **non** blocca l'affinità acustica, ma blocca overlay geometrico senza rigenerazione con versione comune e consenso dell'utente.

**Output:** percentile di vicinanza (intero), sei contributi per parametro, eventuale avviso su qualità o contesto differente; confronto side-by-side con stessa scala e camera. Overlay wireframe [P] dopo validazione dei sistemi di coordinate.

**Compatibilità sperimentale parlanti:** il vincolo originale `stesso parlante >=82%` è eliminato come test deterministico. La PoC misurerà le distribuzioni *intra-speaker* e *inter-speaker*, miscele musicali, differenze di microfono, espressività e contenuto fonetico, senza promettere classificazione individuale.

## 12. Vault IndexedDB: schema, migrazioni, export

Database `voicecrystal`, schema v1. Store `crystals` (key `id` UUID), indici `createdAt`, `sourceKind`, `videoId`, `mappingVersion`. Store `thumbnails` (key `id`, valore `Blob` WebP 256×256). Store `settings` opzionale. Niente PNG nel record (Δ18): l'immagine si rigenera dal seed; il codice di tutte le `geometryVersion` pubblicate resta nel bundle.

```ts
interface CrystalRecordV1 {
  id: string;                   // UUID v4
  specimenNumber: number;       // progressivo locale, per «Esemplare VC-0042»
  schemaVersion: 1;
  createdAt: string;            // ISO-8601 UTC
  title: string;                // testo normalizzato, max 200 caratteri
  speakerLabel: string | null;  // etichetta manuale, mai identificazione automatica
  source: AnalysisSource;       // §9; per 'file' si conserva solo il nome, mai il contenuto
  seed: CrystalSeed;
  confidence: SeedConfidence;
  rawMeasures: readonly [number, number, number, number, number, number];
  extractorVersion: string;
  mappingVersion: string;
  geometryVersion: string;
  comparatorVersion: string;
  captureExitReason: CaptureExitReason;
  quality: QualitySummary;
  geometryHash: string;         // verifica all'apertura: se diverso, errore visibile, mai silenzioso
  tags: string[];
}
```

**Regole [F]:** scrittura atomica per record, validazione schema in import, limite per dimensione di PNG/import, rifiuto di prototipi/script/html in campi testuali, niente URL arbitrari auto-aperti; link sorgente ricostruito da `videoId` validato e timestamp. Cancellazione irreversibile confermata. Metadati personali e label sono sotto controllo dell'utente. Nessun upload automatico.

**Backup [F]:** export in un unico file JSON versionato `voicecrystal-export-v1.json` (`{ format: 'voicecrystal-export', version: 1, exportedAt, records: CrystalRecordV1[] }`), senza immagini: le miniature si rigenerano all'import. Import con validazione di schema (`zod` o equivalente), limite 20 MB [H], deduplica per `id`; in conflitto vince il record locale e l'utente vede l'elenco dei duplicati ignorati. Se un record contiene `speakerLabel`, l'export mostra un avviso sui dati personali di terzi (VC-20). Non promettere persistenza assoluta in presenza di rimozione dell'estensione o pulizia dati. Gestire `QuotaExceededError` senza perdere record esistenti.

**Performance storage [H]:** soglia di avviso a 200 MB stimati (`navigator.storage.estimate()`), non quota garantita. Obiettivo: 1.000 record sotto 50 MB. Miniature generate al salvataggio; mai tutti i canvas in RAM.

## 13. UX: flussi, errori e accessibilità

**Ingresso [F]:** icona VoiceCrystal nella toolbar (avvia la sorgente scheda e apre il pannello). Nel pannello, pulsanti «Usa il microfono» e «Scegli un file». In pagina YouTube un eventuale pulsante discreto apre solo istruzioni. Schermate:

1. **Home (pannello):** «Cristallizza una voce», tre sorgenti, spiegazione che l'audio si analizza solo dopo un'azione esplicita e non viene salvato; ultimi tre esemplari.
2. **Ascolto = nucleazione (pannello):** germe traslucido che cresce con le stime correnti (`provisionalSeed`), etichettato «in crescita, provvisorio»; voce utile `X / 18 s`; stato; interrompi. Mai una percentuale di «saturazione».
3. **Rivelazione (pannello):** il germe si solidifica (animazione ≤ 1,2 s; dissolvenza semplice con `prefers-reduced-motion`); cristallo sul piatto girevole; **cartellino da collezione**; salva/scarta; esporta tavola SVG e PNG.
4. **Collezione (scheda dedicata):** vetrine a griglia di miniature, filtri per abito, colore, sorgente, data; apertura di un esemplare.
5. **Confronto (scheda dedicata):** due esemplari sullo stesso piatto, stessa scala e camera; percentile di vicinanza; sei contributi affiancati.

**Cartellino da collezione [F]:** «Esemplare VC-0042 · Abito: prisma diesagonale · Provenienza: youtube.com/watch?v=… a 1:23 (oppure: microfono / file `nome`) · Raccolto il 9 nov 2026 · Estrattore `extractor-0-experimental`». Serif per il nome dell'esemplare, monospace per i dati, un solo colore d'accento. Font inclusi nel bundle con licenza OFL.

**Legenda viva [F]:** selezionando un tratto del cristallo (o la riga corrispondente nella legenda testuale accessibile) si legge la misura che l'ha generato, es. «Zonatura: 4,1 onset/s, 68° percentile». I tratti velati riportano «confidenza bassa».

**Avviso più voci [F] (D4):** dialogo non bloccante «Sembrano esserci più voci. Parla una sola persona in questo tratto?» con «Sì, continua» e «No, interrompi».

**Senza WebGL [F]:** la tavola SVG sostituisce la vetrina 3D in tutte le schermate.

**Errori espliciti:** nessuna voce, troppa musica, cambio di video, seeking, playback rate diverso da 1×, accesso negato, impossibile mantenere audio, GPU non disponibile, memoria piena, import incompatibile. Per errori di cattura ripristinare audio della scheda in ogni `finally` e chiudere lo stream. Nessun risultato valido deve essere mostrato quando mancano descrittori obbligatori.

**Accessibilità [F]:** contrasto testuale, tastiera, stato leggibile da screen reader, `prefers-reduced-motion`, navigazione senza WebGL dove possibile, colori non unica codifica dei parametri. Nessuna interfaccia che confonda affinità acustica con giudizio sulla persona.

## 14. Sicurezza, privacy e failure modes

- **Origini non fidate:** titolo, metadata e URL provenienti dalla pagina non devono poter eseguire HTML/JS nell'estensione.
- **Permessi minimali:** host limitato, niente `<all_urls>`, niente rete esterna per codice, VAD/WASM bundled. Se una dipendenza richiede eval/remote code, sostituirla.
- **Privacy:** flusso audio in RAM e durata limitata; nessun log PCM, stream ID, token o contenuti del parlato; log diagnostici locali disattivati in produzione, salvo consenso esplicito.
- **No biometric inference:** etichette manuali consentite, nessuna funzione automatica `identifySpeaker()`.
- **DoS locale:** rate limit messaggi interni, limiti coda DSP, limiti su geometria e import, non bloccare UI.
- **Service worker termination:** recupero della sessione tramite offscreen e `chrome.storage.session`, non stato globale volatile; nessuna cattura invisibile dopo stop o chiusura tab.
- **Navigazione fuori pagina:** watchdog di sessione (§5); la cattura non deve mai analizzare l'audio di un sito diverso da YouTube `/watch`.
- **Microfono:** indicatore di registrazione di Chrome sempre visibile durante l'uso; stop immediato alla chiusura del pannello o a 120 s.
- **Lifecycle:** tabCapture `onStatusChanged`, media track `ended`, visibility/content navigation, pausa e cambi video devono portare a transizioni definite.
- **Cross-tab:** impedire sessioni concorrenti, evitare di associare seed a tab diversa per race sulle schede.
- **Licenze terze parti:** registrare versioni, licenze, file attribuzione e SBOM minimalista.

## 15. Validazione scientifica e banco di prova [G1]

**Non usare la sola riproduzione in tempo reale come oracolo.** Il cuore DSP deve accettare PCM da fixture offline con sample rate e metadata espliciti, producendo gli stessi risultati a input equivalenti, senza dipendere dal clock del browser.

### Dataset preliminare proposto [H]

- Minimo esplorativo: 15 parlanti consenzienti, almeno quattro segmenti di parlato per persona, contenuti fonetici e stati espressivi diversi. Non sufficiente a dimostrare accuratezza generale.
- Variabili controllate: gain ±6 dB, rumore di fondo, compressione, differenze di microfono, musica sovrapposta, speaker multipli, contenuto recitato, lingua diversa quando possibile.
- Fixture sintetiche: silenzio, toni, sweep, rumore bianco/rosa, impulsi, clipping, cambi di frequenza, stereo fuori fase.
- Dataset separato: calibrazione degli ancoraggi e **valutazione su segmenti non utilizzati per calibrarli**; conservare soggetti separati quando il numero lo consente.
- Consenso/diritti adeguati per la raccolta e impiego di registrazioni; non inserire nei repository clip audio protette o personali senza titolo.

### Metriche da riportare (senza inventare risultati)

1. Tasso di catture valide su parlato pulito; tasso di rifiuto del silenzio; falsi positivi su musica.
2. Errore/stabilità `f0` su fixture controllate e sensibilità a volume/sample rate.
3. Distribuzioni di ogni `p_i`, correlazioni fra parametri, frequenza di saturazione ai limiti 0/100, valori mancanti.
4. Stabilità del seed su ritagli diversi dello stesso file, variazioni di gain e compressione; distanze intra- e inter-parlante con mediane, IQR e distribuzioni sovrapposte.
5. Differenze fra arresto anticipato e seed ricalcolato da campionamento più lungo, per misurare falsa convergenza.
6. Precisione dei tempi video e affidabilità delle interruzioni di navigazione.
7. Costi CPU/RAM, underrun/drop frame, latenza e degrado percepito del playback.
8. Distribuzione della distanza visiva su campione di seed, collisioni e discontinuità tra bin di simmetria.

**Gate [G1]:** non congelare normalizzazioni né soglie di convergenza finché non esiste un report con dataset, procedura, risultati, casi di fallimento e decisioni motivate. In caso di risultati insufficienti, ridimensionare la promessa o introdurre «modalità sperimentale» esplicita: non nascondere il problema aumentando arbitrariamente la soglia di affinità.

## 16. Test automatizzati, gates e roadmap

### Livello A: unit test deterministici

- Parsing/normalizzazione: edge values, clipping, `NaN`/null, seed interi 0–10.000, half-even, roundtrip seed, monotonia delle tabelle quantili.
- DSP PCM: fixture equivalenti producono seed identici con stesso estrattore, configurazione e runtime; tests per 44,1/48 kHz, resampling, stereo, overflow coda.
- Arresto: mai prima di 8 s, mai senza copertura, tre valutazioni split-half consecutive, timeout (45 s attivi, 120 s assoluti) e motivi d'uscita preservati; fixture A+B senza `CONVERGED` a cavallo del cambio.
- Comparator: identità, simmetria, boundedness, distanza agli estremi, pesi, incompatibilità versioni, monotonia del percentile; property-based testing.
- Crystal Core: due chiamate identiche → array bit-identici; `geometryHash` identico in Node, Chrome, Firefox su 1.000 seed dorati; proprietà di continuità (§10); convessità e chiusura (formula di Eulero V − E + F = 2); coordinate finite; budget triangoli; assenza di funzioni `Math` vietate nel percorso dei vertici (lint).
- Renderer SVG: stesso input → stesso SVG byte per byte.
- Storage: migrazioni, transazioni, import malevolo, quota piena, duplicate `id`, export/import.

### Livello B: integration test Chrome reale

- Avvio toolbar -> offscreen -> tabCapture -> audio pass-through -> stop; verifica su Chrome desktop reale, non sola mock API.
- Content script e Side Panel: evento gesto utente; SPA navigation; cambio scheda, `seek`, `pause`, `rate=1.5`, stop, refresh, chiusura tab.
- Sessioni concorrenti: doppio click, due tab, messaggi vecchi, worker sospeso, stream ID scaduto, `getUserMedia` fallito.
- Attivazione/ripristino audio: registrazione di test loopback separata e ascolto manuale; nessun silenziamento persistente né doppio routing. Eventuali micro-interruzioni vanno quantificate.
- GPU: WebGL assente, context lost e fallback statico senza crash.

### Livello C: valutazione empirica / performance

Target preliminari **[H], da misurare su un PC di riferimento esplicitamente documentato**, non SLA universali:

- Nessun silenziamento persistente dopo stop, errori o chiusura tab: tolleranza zero.
- Nessun `PROCESSING_OVERRUN` nelle fixture di carico nominale; documentare quando appare sotto stress.
- UI responsiva durante l'ascolto; rendering del cristallo misurato a 50°/90°/95° percentile su hardware di riferimento.
- Nessun audio PCM persistito, nessun codice remoto eseguito, nessuna chiamata di telemetria.
- Nessun crash su almeno 100 cicli ripetuti start/stop con misurazione crescita memoria.

### Roadmap con cancelli di avanzamento

| Fase | Deliverable | Exit gate |
|---|---|---|
| 0 | Revisione avversariale ✅ (9 nov 2026) + avvio valutazione legale | Decisioni D1–D5 ✅; G0 in corso |
| 1 | PoC cattura scheda e microfono, pass-through, watchdog, ciclo di vita | [G-PoC] la cattura non compromette il player; errori governati |
| 2 | DSP offline, fixture, dataset, quantili | [G1] report quantitativo + `mapping-1` congelato |
| 3 | Crystal core a semispazi, vetrina WebGL, tavola SVG | [G2] geometria riproducibile, continuità dimostrata |
| — | — | **[G0] obbligatorio prima della fase 4** |
| 4 | Side Panel, Collezione, Vault, Comparator | Test integrazione e persistenza superati |
| 5 | Hardening e distribuzione | Accessibilità, privacy, performance, policy e packaging verificati |

Le fasi 2 e 3 possono procedere in parallelo alla 1 (nucleo puro indipendente da Chrome). Il dettaglio di ogni gate è in `docs/GATES.md`; le issue in `docs/BACKLOG.md`.

### Condizioni esplicite di NO-GO

- Impossibilità di garantire audio pass-through o stop pulito in Chrome reale.
- Dipendenza inderogabile da acquisizione remota o bypass dei vincoli di piattaforma.
- Seed che cambiano in modo sostanziale per perturbazioni innocue (gain, codec, piccole variazioni temporali) senza che ciò venga misurato e spiegato.
- Impossibilità di distinguere parlato utile da musica al livello minimo richiesto dalla promessa di prodotto.
- Mapping congelato senza dataset o metrica presentata come probabilità biometrica.
- Violazioni di condizioni applicabili/policy non risolte per il canale di distribuzione previsto.

## 17. Revisione avversariale

La revisione avversariale della v0.2 è stata eseguita il 9 novembre 2026 (`docs/ADVERSARIAL_REVIEW.md`): verdetto **CONDITIONAL GO** per le fasi 1–3, NO-GO per la distribuzione finché G0 non è chiuso. I 23 rilievi `VC-01`…`VC-23` sono tracciati in `docs/RISK_REGISTER.md`.

**Revisioni successive [F]:** ogni gate (G-PoC, G1, G2, G0, release) richiede una nuova revisione avversariale indipendente, eseguita da un agente che non ha scritto il codice in esame (`.claude/agents/adversarial-reviewer.md`), con lo stesso formato: verdetto, registro dei rilievi per severità con prova e test, scenari, contraddizioni, spec delta. Ogni rilievo BLOCKER/CRITICAL contiene una prova o un test falsificabile; ogni API non verificata è marcata `needs current-doc verification`.

## 18. Decision register

Le decisioni architetturali sono in `docs/ADR/` (formato MADR breve). Indice:

| ADR | Stato | Decisione |
|---|---|---|
| ADR-0001 | Accettato | Chrome MV3: `tabCapture` → offscreen → AudioWorklet → DSP worker |
| ADR-0002 | Accettato | Avvio: `sidePanel.open()` sincrono in `action.onClicked`, niente `setPanelBehavior` |
| ADR-0003 | Accettato | Offscreen con motivi `USER_MEDIA`, `WORKERS`; mai `AUDIO_PLAYBACK` |
| ADR-0004 | Accettato | Watchdog di sessione con heartbeat |
| ADR-0005 | Accettato | Generatore a intersezione di semispazi con forme cristallografiche reali |
| ADR-0006 | Accettato | Normalizzazione per quantili e seed interi |
| ADR-0007 | Accettato | Affinità presentata come percentile di vicinanza |
| ADR-0008 | Accettato | Arresto per stabilità split-half |
| ADR-0009 | Accettato | Doppia sorgente: scheda e «La tua voce» |
| ADR-0010 | Accettato | Determinismo: quantizzazione e trigonometria propria |
| ADR-0011 | Accettato | Macchina di cattura separata dalla macchina della vista |
| ADR-0012 | Accettato | Resa «vetrina museale» con Three.js |
| ADR-0013 | Accettato | Tavola cristallografica SVG come export canonico e fallback |
| ADR-0014 | Accettato | Confidenza per parametro e tratti velati |

**Ipotesi aperte [H]** (da chiudere al gate indicato): 8/18/45/120 s e τ = 6 punti (G1); pesi 1/6 (G1); soglie VAD, musica, più voci (G1); costanti del cammino delle forme e soglia di continuità 0,03 (G2).

**Post-MVP [P]:** diarizzazione, affinità geometrica, overlay wireframe, altri browser, i18n.

## 19. Riferimenti ufficiali

Riferimenti consultati al 9 novembre 2026 (sidePanel, tabCapture, offscreen e Termini YouTube verificati durante la revisione), **non sostituiscono i test in Chrome reale né una consulenza legale**:

- Chrome tabCapture API: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Chrome audio recording/tab capture example: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Chrome offscreen documents: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Chrome Side Panel: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome MV3 CSP: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- Chrome remotely hosted code: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- Chrome permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- MDN AudioWorkletProcessor process: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- YouTube Terms of Service: https://www.youtube.com/terms
- Thread Chromium Extensions su `openPanelOnActionClick` e `action.onClicked`: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/q6SuRSMIYo4
- Thread Chromium Extensions su `sidePanel.open()` e gesto utente: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/WRGFOAHxoaY
- YouTube API Developer Policies (applicabilità da verificare): https://developers.google.com/youtube/terms/developer-policies

---

**Regola finale:** il successo di VoiceCrystal non dipende dalla possibilità di produrre un cristallo bello; dipende dalla possibilità di dimostrare che una variazione osservabile della voce provoca una variazione geometrica interpretabile e riproducibile, con limiti esplicitati. Se questo fallisce, il progetto deve rimanere un generatore artistico dichiarato come tale, non essere presentato come sistema di riconoscimento vocale.
