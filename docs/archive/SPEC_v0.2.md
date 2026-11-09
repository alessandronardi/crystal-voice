# VoiceCrystal — Specifica tecnica di sviluppo

**Versione:** 0.2.0 — baseline per revisione avversariale  
**Data:** 9 novembre 2026  
**Stato:** PROPOSTA TECNICA / NON APPROVATA PER IMPLEMENTAZIONE  
**Destinatario:** agente di programmazione e agente revisore indipendente  
**Ambito:** estensione Chrome Manifest V3, DSP vocale, generazione procedurale 3D, IndexedDB  
**Lingua delle interfacce:** italiano (predisposizione i18n, non nel primo MVP)

> **ISTRUZIONE PRIORITARIA PER L'AGENTE:** questo documento non autorizza ancora a sviluppare il prodotto completo. Esegui prima la revisione avversariale richiesta nel capitolo 17. Se un requisito è contraddittorio o impossibile, segnalalo e proponi una correzione verificabile, senza sostituirlo silenziosamente con una tua interpretazione. Non attribuire mai risultati sperimentali a test non eseguiti.

## Legenda delle decisioni

- **[F] Fissato:** scelta normativa per l'MVP, salvo evidenze contrarie nella revisione.
- **[H] Ipotesi da calibrare:** default implementabile nella proof of concept; non è una soglia scientificamente validata.
- **[G] Gate:** condizione di avanzamento obbligatoria.
- **[P] Post-MVP:** funzione esplicitamente esclusa dal primo rilascio.
- **[R] Rischio residuo:** problema che l'architettura non è in grado di eliminare con garanzia assoluta.

## 1. Intento del prodotto e promessa corretta

**Obiettivo:** trasformare un segmento di parlato riprodotto su YouTube in un cristallo tridimensionale generato deterministicamente da sei descrittori acustici normalizzati. Consentire raccolta locale, esportazione e confronto fra cristalli.

**Promessa dell'MVP:** «Ogni cristallo è una visualizzazione riproducibile delle proprietà acustiche misurate in un segmento di parlato».

**Non promettere:** identità biometrica, riconoscimento del parlante, classificazione delle emozioni, isolamento perfetto della voce dalla musica, saturazione scientifica universale, immagine pixel-identica su qualsiasi GPU.

**Priorità:** (1) affidabilità e trasparenza della cattura, (2) coerenza matematica dei seed, (3) differenziazione visiva informativa, (4) esperienza estetica, (5) funzioni di collezione.

**Principio estetico [F]:** mineralogia digitale: cristalli credibili, silhouette leggibile, riflessi controllati, interfaccia sobria da collezione museale. La bellezza non può sostituire la tracciabilità dei parametri.

## 2. Confini di prodotto e non-obiettivi

### In scope per l'MVP [F]

- Chrome desktop con `minimum_chrome_version` impostata a `120` (requisito di prodotto conservativo; le API fondamentali sono disponibili già da Chrome 116).
- Pagine `https://www.youtube.com/watch` con un video on-demand standard e **una sola cattura attiva per profilo**.
- Avvio esplicito dall'azione dell'estensione nella toolbar; pannello laterale per avanzamento, rivelazione, archivio e confronto.
- Audio analizzato localmente e cancellato dalla memoria alla chiusura della sessione. Persistenza solo di seed, metadati, indicatori di qualità, geometria versionata e PNG opzionale.
- Sei parametri scalari nell'intervallo `[0,100]`, versione dell'estrattore, versione della mappatura e versione del generatore geometrico.
- Archivio IndexedDB con export/import e cancellazione.
- Analisi su audio PCM locale per test offline, indipendente da YouTube e da Chrome.

### Out of scope [F]/[P]

- Shorts, live stream, video con più parlanti sovrapposti, karaoke/canzoni, contenuti prevalentemente musicali: **non supportati garantitamente** in v0.2.
- Riconoscimento delle persone, voiceprint biometrico, separazione delle sorgenti mediante reti neurali pesanti, diarizzazione robusta multi-speaker [P].
- Backend, cloud sync, account, analytics remota, registrazione persistente di audio, download di video/audio [F: vietati nell'MVP].
- Estensioni Firefox/Safari/Edge: da valutare dopo Chrome [P].
- Generazione generica da qualunque media web, composizioni musicali, sentiment analysis [P].
- Confronto avanzato delle mesh tramite Hausdorff/Chamfer come metrica ufficiale [P].

## 3. Vincolo legale e distribuzione [G0]

Il fatto che un'API del browser permetta di acquisire l'audio di una scheda **non dimostra** che ogni uso sia permesso dalle condizioni della piattaforma o dai diritti sul contenuto. I termini di YouTube prevedono restrizioni sull'uso dei contenuti; le regole aggiuntive dei servizi API non si applicano automaticamente in egual modo a un'estensione che non utilizza quelle API.

**Decisione [F]:** non utilizzare YouTube Data API; non scaricare né memorizzare media; non bypassare DRM, pubblicità, limitazioni geografiche o controlli tecnici; non alterare il flusso del player; limitare i dati a metadati di navigazione e caratteristiche calcolate in memoria.

**Gate [G0]:** prima di distribuire al pubblico (e preferibilmente prima di investire oltre la PoC), ottenere una valutazione documentata delle condizioni YouTube, della disciplina applicabile e delle policy del Chrome Web Store. Se la compatibilità non può essere ragionevolmente sostenuta, **non pubblicare una estensione YouTube**: il nucleo DSP/3D deve rimanere riutilizzabile in una web app che analizza audio fornito dall'utente con titolo legittimo. Questa via alternativa non autorizza alcun aggiramento tecnico.

## 4. Stack e organizzazione dei moduli

**Stack [F]:** TypeScript `strict`, ES Modules, Vite/Rollup con build multi-entry MV3, Three.js, Tailwind CSS compilato localmente (nessuna CDN), IndexedDB nativo tramite adapter con migrazioni, Vitest per test unitari, Playwright per la UI e script di test E2E dell'estensione. DSP in TypeScript/JavaScript; modulo VAD locale preferibilmente WebAssembly, soggetto a licenza e verifica MV3.

**Perché TypeScript:** i contratti tipizzati, l'identità delle versioni e gli stati di cattura riducono gli errori di integrazione rispetto a JavaScript non tipizzato. Il bundle finale rimane JavaScript.

**Organizzazione consigliata:**

```text
voicecrystal/
  docs/
    SPEC_v0.2.md
    ADR/
    BENCHMARK_PROTOCOL.md
    ADVERSARIAL_REVIEW.md
  extension/
    manifest.json
    src/
      background/service-worker.ts
      content/youtube-adapter.ts
      offscreen/offscreen.html
      offscreen/audio-session.ts
      offscreen/pcm-processor.ts       # AudioWorklet: sola acquisizione/accumulo
      offscreen/dsp-worker.ts          # elaborazione non realtime
      sidepanel/index.html
      sidepanel/app.ts
      ui/components/
  packages/
    contracts/
    dsp-core/                        # zero dipendenze Chrome/DOM
    crystal-core/                    # funzione pura, no Three.js nel core
    renderer-three/
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
    export-fixtures/
  package.json
  tsconfig.json
```

**Regola dei confini [F]:** `dsp-core`, `crystal-core` e `comparator` sono librerie pure senza API Chrome. `audio-session` gestisce stream e clock. `renderer-three` crea/dispone risorse WebGL. `vault` è l'unico livello che accede a IndexedDB. `youtube-adapter` legge metadati/controlli del video e non processa audio.

## 5. Architettura MV3 e permessi

### Componenti e responsabilità [F]

1. **Content Script, isolated world:** opzionale elemento UI non invasivo; lettura sicura di `videoId`, `currentTime`, `paused`, `playbackRate`, eventi `seeking`, `seeked`, `play`, `pause`, cambio video SPA. Nessun accesso a variabili interne non documentate di YouTube.
2. **Service Worker:** gestisce `chrome.action.onClicked`, autorizzazione tab, apertura/gestione dell'offscreen document, routing dei messaggi, session token, collisioni tra catture. Nessun AudioContext, FFT, accumulo lungo o stato RAM autorevole.
3. **Offscreen Document:** `getUserMedia` con stream ID di tabCapture, `AudioContext`, playback pass-through, `AudioWorklet`, DSP worker e stato runtime della cattura. La documentazione limita le API estensione accessibili dall'offscreen document a `chrome.runtime`.
4. **Side Panel:** UI, dettaglio risultati, invocazioni tramite messaggi, renderer Three.js, archivio e confronti.
5. **IndexedDB:** storage nell'origine dell'estensione, mai nello storage della pagina YouTube.

### Permessi di partenza [F]

```json
{
  "manifest_version": 3,
  "name": "VoiceCrystal",
  "version": "0.2.0",
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

**Nota:** manifest **schematico** da compilare/validare; i file finali devono esistere nel bundle. Nessun permesso generale `https://*/*`; verificare la compatibilità del match pattern con le URL reali. Se possibile rimuovere `storage` quando non necessario (IndexedDB non richiede quel permesso); `storage` serve soltanto per preferenze/sessione minima. Nessuna richiesta di `microphone` o `desktopCapture` per il caso ordinario.

### Avvio e mantenimento della cattura [F]

Sequenza normativa:

```text
Utente clicca icona estensione (Chrome action)
  → SW controlla tabId, URL, assenza di altra sessione
  → SW assicura offscreen document (createDocument USER_MEDIA, AUDIO_PLAYBACK; WORKERS se necessario)
  → SW ottiene tabCapture.getMediaStreamId({ targetTabId: tabId })
  → SW invia subito l'ID una sola volta all'offscreen document
  → offscreen getUserMedia({audio: chromeMediaSource:'tab', chromeMediaSourceId:ID, video:false})
  → offscreen AudioContext: stream source → destination (ascolto utente)
  → ramo analisi → AudioWorklet → DSP worker (nessun doppio audio)
  → session started / audio confirmed / metadata synced
  → raccolta → risultato → stop tracks / close context / release resources
```

**Vincoli cruciali:** lo stream ID è monouso e scade dopo pochi secondi; non deve essere salvato né messo in coda. Prevedere timeout, tentativi limitati e avviso esplicito in caso di errore. La cattura della scheda può silenziare l'audio normalmente riprodotto: è obbligatorio un percorso di playback verso `AudioContext.destination`. Testare che l'uscita audio non sia duplicata, distorta o interrotta. Chrome può terminare il service worker: lo stato di cattura non deve dipendere da variabili globali del worker.

**UX di autorizzazione:** per l'MVP il pulsante dentro YouTube può aprire la Side Panel e spiegare come avviare la cattura; **non deve essere l'unico percorso di attivazione audio**. Il click sulla action della toolbar è l'avvio supportato e verificabile. Aprire la side panel nello stesso gesto è da validare in integrazione, perché le API con user activation possono avere interazioni; prevedere una gestione alternativa se fallisce.

**Una cattura globale [F]:** una sola sessione per profilo, per evitare conflitto fra offscreen singleton, sorgente audio e stato dei browser tabs. Una seconda richiesta riceve `CAPTURE_BUSY` con opzione per interrompere la prima.

## 6. Macchina a stati e modello temporale

### Stati normativi

```text
IDLE
  └─ START_REQUEST → AUTHORIZING
AUTHORIZING
  ├─ acquired → LISTENING
  └─ denied/timeout → ERROR
LISTENING
  ├─ VAD pause → WAITING_FOR_SPEECH
  ├─ converged → FINALIZING
  ├─ valid voice limit → FINALIZING
  ├─ wall timeout → FINALIZING or INSUFFICIENT_DATA
  ├─ seek/video mismatch/ad/invalid media/stop → INTERRUPTED
  └─ stream ended/capture error → ERROR
WAITING_FOR_SPEECH
  ├─ voice resumes → LISTENING
  ├─ timeout → FINALIZING or INSUFFICIENT_DATA
  └─ stop/error → INTERRUPTED/ERROR
FINALIZING
  ├─ quality pass → REVEALED
  └─ quality fail → INSUFFICIENT_DATA
REVEALED
  ├─ SAVE → SAVED
  ├─ COMPARE → COMPARING
  └─ DISCARD → IDLE
```

**Invarianti [F]:** non produrre un `CrystalSeed` ufficiale senza `quality.accepted === true`; `stop()` deve essere idempotente; ogni chiamata asincrona è associata a `sessionId`; messaggi vecchi sono ignorati; pulizia di stream, audio nodes e worker in `finally`; chiusura scheda/estensione interrompe la cattura.

**Tempi [H]:** minimo 8 s di parlato valido; massimo 18 s di parlato valido; massimo 45 s trascorsi dall'avvio, esclusi blocchi intenzionali della cattura dovuti a pausa player (ma con timeout assoluto di sicurezza definito e testato). Oltre 45 s di ascolto attivo non si continua ad accumulare. Il tempo è misurato su campioni audio, non su conteggi `setInterval`.

**Timeline video [F]:** stream audio e metadata timeline non sono intrinsecamente sample-accurate; la sincronizzazione `currentTime` è approssimata e deve essere dichiarata tale. Campionare eventi/timeupdate del video e rilevare salti, variazioni rate e variazione `videoId`. Con `playbackRate !== 1` interrompere/invalidate la sessione per non deformare `f0`; con `seeking/seeked` interrompere; con `paused` congelare l'accumulo; con navigazione SPA o pubblicità rilevata interrompere. Se impossibile riconoscere attendibilmente contenuto pubblicitario o cambio sorgente, dichiarare il limite e non simulare affidabilità. Conservare `timeStartSeconds`, `timeEndSeconds`, `videoId`, `validSpeechSeconds`, `elapsedSeconds` e `timelineQuality`.

## 7. Pipeline DSP: contratto e algoritmi

### 7.1 Acquisizione PCM [F]

- L'audio deve restare in RAM; non usare `MediaRecorder` e non scrivere WAV in IndexedDB.
- `AudioWorkletProcessor` raccoglie blocchi PCM, non esegue FFT costose o attività asincrone nel thread audio. Dimensione dei blocchi: **non assumere hardcode 128**; leggere la lunghezza del buffer ricevuto.
- Convertire stereo in mono con regole documentate e testate; verificare casi con canali fuori fase. Conservare `sourceSampleRate`, `analysisSampleRate`, `channelCount` e indicazioni clipping.
- Resampling deterministico con filtro anti-alias prima del VAD (target 16 kHz); il DSP per centroide/pitch può utilizzare una frequenza diversa se motivata e testata.
- `dsp-worker` processa in batch brevi; usare coda limitata e segnalare `PROCESSING_OVERRUN` quando la CPU non tiene il passo. Niente drop di frame non contabilizzati.
- L'ordine dei frame e i rispettivi campioni audio, non l'ordine di arrivo dei messaggi, determina le statistiche.

### 7.2 VAD e qualità [F]

- VAD locale a frame di 20 ms a 16 kHz, preferibilmente un'implementazione WebRTC con licenza e packaging verificati; il filtro `RMS + 85–3400 Hz` è ammesso **solo** come pre-filtro e diagnostica, non come VAD principale.
- Il VAD identifica probabilmente il parlato, **non** certifica l'assenza di musica né l'identità del parlante.
- Scartare dal seed frame muti, clip con clipping grave, frame con qualità insufficiente e intervalli non coerenti con il segmento video.
- `voiceConfidence` e `signalQuality` vanno distinti. Se il motore VAD restituisce solo etichetta binaria, non inventare una probabilità: registrare `vadDecision` e qualità del segnale separatamente.
- Per la prima versione utilizzare controlli conservativi su predominanza musicale e voci sovrapposte; se il rilevatore non ha confidenza, segnalare `MIXED_AUDIO_UNCERTAIN`. Non attribuire un'etichetta `singleSpeaker` se non si dispone di diarizzazione.

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

### 7.4 Sei descrittori [F per il significato; H per la calibrazione]

1. `p1_symmetry` — mediana robusta di `log2(f0)` su frame con pitch attendibile. Influenza numero di lati e simmetria del prisma.
2. `p2_facets` — combinazione versionata di dispersione robusta di `log2(f0)` e variabilità spettrale su frame parlati. Influenza smussi, troncature e dettagli faccettati.
3. `p3_spires` — escursione dinamica robusta dell'RMS (ad es. P90–P10 dei dBFS dopo esclusione del rumore) e densità relativa dei picchi. Influenza allungamento e crescita secondaria.
4. `p4_inclusions` — distribuzione di periodicità/armonicità e contenuto rumoroso della voce nei frame vocali. Più irregolarità -> maggiore densità delle inclusioni; evitare che il rumore ambientale venga interpretato come timbro.
5. `p5_hue` — centroide spettrale robusto, preferibilmente relativo a bande voce e condizionato a qualità/voicing, con mappatura **monotona** su palette da ambra/rubino a ciano/zaffiro. Evitare l'uso di hue circolare per la distanza numerica.
6. `p6_halo` — statistica di onset ed envelope per il ritmo del parlato, con minimo di eventi sufficienti. Influenza anelli, raggi e densità dei motivi concentrici.

**Avvertenza:** questi sei descrittori sono una rappresentazione artistica di proprietà acustiche, non fattori fisici indipendenti e non una metrica certificata di identità del parlante. Alcuni sono fortemente dipendenti dal contenuto fonetico e dalla catena di registrazione. La calibratura serve a contenere, non a eliminare, tali dipendenze.

### 7.5 Normalizzazione, qualità e seed canonico

Ogni caratteristica grezza `x_i` è trasformata mediante una **funzione monotona versionata** `g_i`, con ancoraggi `low_i`, `high_i` fissati su un dataset di riferimento; ad esempio:

```text
p_i = 100 * clamp((g_i(x_i) - g_i(low_i)) /
                  (g_i(high_i) - g_i(low_i)), 0, 1)
```

Per pitch è preferibile `g_i(x)=log2(x)` quando `x>0`. I valori degli ancoraggi non devono essere stimati separatamente per ogni clip: altrimenti la stessa voce in clip differenti non è confrontabile. **[G1]** Gli ancoraggi definitivi vengono congelati solo dopo una PoC su dataset di calibrazione; prima utilizzare un file di configurazione marcato `EXPERIMENTAL`.

**Regole canoniche [F]:** ordine dei parametri immutabile; sei numeri finiti in `[0,100]`; arrotondamento alla precisione fissa di 0,01 con metodo documentato; niente `NaN`, `Infinity`, default a zero per feature mancanti o array di lunghezza variabile. Se un descrittore necessario non è stimabile con qualità minima, il risultato è `INSUFFICIENT_DATA`, non un cristallo valido.

```
CrystalSeed = [p1_symmetry, p2_facets, p3_spires,
               p4_inclusions, p5_hue, p6_halo]
```

## 8. Arresto adattivo: non «saturazione spettrale» assoluta

**Terminologia [F]:** `feature_convergence` / «stabilità del campionamento». Il testo UI non deve dichiarare una percentuale scientifica di saturazione di una voce.

Tre condizioni **tutte necessarie** per terminazione anticipata:

1. Durata di parlato valido `>= 8 s` [H].
2. Copertura minima: conteggio sufficiente di frame con `f0`, variabilità fonetica/spettrale, eventi di envelope; nessun descrittore fondamentale mancante. Le soglie di copertura vanno calibrate [G1].
3. Convergenza delle sei statistiche normalizzate su **almeno tre valutazioni consecutive**, distanziate di un secondo di parlato valido.

Metrica sperimentale:

```text
c_t = sqrt( Σ_i w_i * ((m_i(t) - m_i(t - 3s_voce)) / 100)^2 )
```

Dove `m_i(t)` è una stima robusta della caratteristica i usando **tutti** i frame validi disponibili fino al tempo t, `w_i >= 0`, `Σ_i w_i=1`; le stime storiche sono snapshot per durata cumulativa di voce valida, non finestre cronologiche durante il silenzio. Condizione sperimentale iniziale: `c_t <= 0.02` [H], da calibrare su falsi arresti e stabilità successiva. La convergenza delle medie non sostituisce i requisiti di copertura.

Arresti:

- `CONVERGED` se tutte le condizioni sono vere.
- `MAX_VALID_SPEECH` a 18 s: cristallo consentito soltanto se `quality.accepted=true`, marcato **terminato per limite**, non «saturato».
- `WALL_TIMEOUT` a 45 s di tempo attivo: idem.
- `INSUFFICIENT_DATA` se qualità/coprertura non superano i criteri.
- `INTERRUPTED` su seek, cambio video, stream stop, sospetta contaminazione grave non recuperabile.

**UI:** mostra `voce utile: X / 18 s` e stato `Raccolta`, `Voce non rilevata`, `Stabilità raggiunta`, `Qualità insufficiente`. La barra progresso può rappresentare il completamento del budget di campionamento, non una certezza probabilistica.

## 9. Contratti di dati e messaggi

I messaggi tra componenti sono discriminated unions e includono versione protocollo, sessione e numero progressivo. Non trasmettere PCM al service worker o alla UI.

```ts
type SessionId = string;
type CaptureState =
  | 'IDLE' | 'AUTHORIZING' | 'LISTENING' | 'WAITING_FOR_SPEECH'
  | 'FINALIZING' | 'REVEALED' | 'SAVED' | 'COMPARING'
  | 'INSUFFICIENT_DATA' | 'INTERRUPTED' | 'ERROR';

type CaptureExitReason =
  | 'CONVERGED' | 'MAX_VALID_SPEECH' | 'WALL_TIMEOUT'
  | 'USER_STOP' | 'VIDEO_SEEK' | 'VIDEO_CHANGED'
  | 'PLAYBACK_RATE_CHANGED' | 'AD_INTERRUPTION'
  | 'STREAM_ENDED' | 'QUALITY_REJECTED' | 'CAPTURE_ERROR';

type CaptureMessage =
  | { v: 1; type: 'CAPTURE_START'; sessionId: SessionId; tabId: number }
  | { v: 1; type: 'CAPTURE_STOP'; sessionId: SessionId; reason: 'USER_STOP' }
  | { v: 1; type: 'CAPTURE_PROGRESS'; sessionId: SessionId;
      seq: number; state: CaptureState; validSpeechMs: number;
      elapsedMs: number; qualitySummary: QualitySummary }
  | { v: 1; type: 'CAPTURE_RESULT'; sessionId: SessionId;
      seq: number; result: AnalysisResult }
  | { v: 1; type: 'CAPTURE_FAILED'; sessionId: SessionId;
      seq: number; code: CaptureErrorCode };

interface QualitySummary {
  accepted: boolean;
  validSpeechMs: number;
  pitchUsableFrames: number;
  vadSpeechFrames: number;
  droppedFrames: number;
  clippedFraction: number;
  missingFeatureKeys: string[];
  warnings: string[];
}

type CaptureErrorCode =
  | 'NOT_YOUTUBE_WATCH' | 'CAPTURE_BUSY' | 'PERMISSION_DENIED'
  | 'STREAM_ID_EXPIRED' | 'STREAM_NOT_AVAILABLE' | 'OFFSCREEN_FAILED'
  | 'AUDIO_CONTEXT_FAILED' | 'PROCESSING_OVERRUN'
  | 'PLAYBACK_ROUTING_FAILED' | 'VIDEO_UNSUPPORTED'
  | 'INTERNAL_ERROR';

interface AnalysisResult {
  seed: readonly [number, number, number, number, number, number];
  extractorVersion: string;
  mappingVersion: string;
  exitReason: CaptureExitReason;
  quality: QualitySummary;
  source: {
    platform: 'youtube';
    videoId: string;
    title: string;
    timeStartSeconds: number | null;
    timeEndSeconds: number | null;
    timelineQuality: 'estimated' | 'unknown';
    playbackRate: 1;
  };
}
```

**Contratto di errore:** `CAPTURE_FAILED` non equivale a un risultato incompleto valido. `CAPTURE_RESULT` deve essere emesso una sola volta e solo dopo la pulizia della sessione audio. Per eventi inattesi, log locale di errore senza audio o stream ID. Sanitizzare `title` e dati importati come testo, non come HTML.

## 10. Generatore di cristalli: determinismo verificabile

### Interfacce normative [F]

```ts
type CrystalSeed = readonly [number, number, number, number, number, number];

interface CrystalGeometry {
  geometryVersion: string;
  positions: Float32Array;   // xyz, ordine canonico
  normals: Float32Array;     // xyz, ordine canonico
  indices: Uint32Array;     // triangoli, ordine canonico
  groups: readonly { start: number; count: number; materialId: number }[];
  instances: readonly {
    kind: 'primary' | 'secondary' | 'inclusion';
    transform: readonly number[]; // matrice 4x4 canonica
  }[];
  geometryHash: string;
}

function generateCrystalGeometry(
  seed: CrystalSeed,
  geometryVersion: string
): CrystalGeometry;

function renderCrystal(
  geometry: CrystalGeometry,
  config: RenderConfig
): RenderHandle;

function exportCrystalPng(handle: RenderHandle, resolution: number): Promise<Blob>;
```

**Nota:** la definizione finale dei normali, groups e inclusion volumes può variare nel prototipo geometrico; dopo il gate [G2] lo schema viene congelato. Il rendering non è parte della funzione pura.

### Mapping geometrico [F]

- `p1_symmetry` -> numero lati del prisma (3–12), corona, modulo di rotazione. Formula nominale: `n = 3 + min(9, floor(10 * p1 / 100))`. È una **quantizzazione discontinua**: i test devono coprire i confini dei bin.
- `p2_facets` -> numero e profondità dei tagli, truncation/crown bevel, budget massimo triangoli.
- `p3_spires` -> rapporto altezza/larghezza, numero e inclinazione delle crescite secondarie.
- `p4_inclusions` -> densità di difetti/lattice e superfici interne senza auto-intersezioni incontrollate.
- `p5_hue` -> gradiente cromatico monotono rubino/ambra → ciano/zaffiro, non una hue wheel ciclica.
- `p6_halo` -> motivi concentrici e geometria decorativa dello sfondo, **separati** dalla mesh del cristallo; non devono cambiare l'hash della sua geometria.

**Determinismo:** PRNG seedato da hash canonico `(seed quantizzato, geometryVersion, domainLabel)`. Usare domini separati per `facets`, `inclusions`, `secondary`: aggiungere una chiamata casuale in un dominio non deve perturbare gli altri. Vietati `Math.random`, Date, clock, stato globale e risorse GPU come input della geometria. Definire roundtrip e serializzazione canonica, ordine vertici, floating precision, tie-breaking e codifica del buffer. `geometryHash` è SHA-256 dei buffer geometria canonizzati, non del PNG.

**Portabilità:** identità bitwise degli array garantita solo sotto ambiente JS/implementazione/versione di build specificati e testati; compatibilità multipiattaforma da verificare. La rasterizzazione WebGL, trasparenza e rifrazione fisica **non** promettono PNG identici tra GPU/driver/browser.

**Qualità e robustezza:** mesh con winding coerente, assenza di NaN/Inf, limiti su numero triangoli e memoria, `dispose()` esplicito di geometrie/materiali/texture/render target; gestione `webglcontextlost`. Una modalità renderer «economy» non cambia il seed né la mesh primaria.

**Profilo visivo iniziale [H]:** scena scura neutra, camera ortografica, tre luci fisse, un cristallo principale, crescita secondaria contenuta, materiali standard prima di attivare transmission costosa. PNG 1024×1024 con preset di camera, DPR ed exposure fissi. Le immagini sono output estetici e non dati scientifici.

## 11. Comparator: affinità acustica, non probabilità d'identità

**Algoritmo MVP [F]:** distanza euclidea pesata tra seed della **stessa mappingVersion**.

```text
D(A,B) = sqrt( sum_{i=1..6} w_i * ((A_i - B_i) / 100)^2 )
Affinity(A,B) = 100 * clamp(1 - D(A,B), 0, 1)
w_i >= 0, sum_i w_i = 1
```

Pesi iniziali [H]: `w_i = 1/6` per ogni parametro. Qualunque peso alternativo deve avere `comparatorVersion` esplicita e motivazione sperimentale.

**Invarianti matematiche:** simmetria; identità `Affinity(A,A)=100`; estremi opposti 0 e 100 su tutte le dimensioni con pesi positivi -> 0; valori finiti e sempre `[0,100]`; monotonia rispetto all'aumento della differenza assoluta in una singola componente, a parità di altre componenti. Vietato interpretare la percentuale come «probabilità che sia la stessa persona».

**Compatibilità:** confronto bloccato se `mappingVersion` diversa o seed malformati, salvo migrazione esplicitamente definita e verificata. `extractorVersion` diversa richiede almeno avviso e una policy di compatibilità documentata; default conservativo: blocco quando la semantica delle feature cambia. `geometryVersion` diversa **non** blocca l'affinità acustica, ma blocca overlay geometrico senza rigenerazione con versione comune e consenso dell'utente.

**Output:** percentuale descrittiva (una cifra decimale), sei contributi per parametro, eventuale avviso su qualità o contesto differente; confronto side-by-side con stessa scala e camera. Overlay wireframe [P] dopo validazione dei sistemi di coordinate.

**Compatibilità sperimentale parlanti:** il vincolo originale `stesso parlante >=82%` è eliminato come test deterministico. La PoC misurerà le distribuzioni *intra-speaker* e *inter-speaker*, miscele musicali, differenze di microfono, espressività e contenuto fonetico, senza promettere classificazione individuale.

## 12. Vault IndexedDB: schema, migrazioni, export

Database `voicecrystal`, schema v1. Store `crystals` (key `id` UUID), indici `createdAt`, `videoId`, `mappingVersion`. Store `settings` opzionale. Le immagini come `Blob` se disponibili, non Base64 come valore principale.

```ts
interface CrystalRecordV1 {
  id: string;
  schemaVersion: 1;
  createdAt: string;            // ISO-8601 UTC
  title: string;                // testo normalizzato e limitato
  speakerLabel: string | null;  // etichetta manuale, mai identificazione automatica
  source: {
    platform: 'youtube';
    videoId: string;
    timeStartSeconds: number | null;
    timeEndSeconds: number | null;
    timelineQuality: 'estimated' | 'unknown';
  };
  seed: CrystalSeed;
  extractorVersion: string;
  mappingVersion: string;
  geometryVersion: string;
  comparatorVersion: string;
  captureExitReason: CaptureExitReason;
  quality: QualitySummary;
  geometryHash: string;
  png: Blob | null;
  tags: string[];
}
```

**Regole [F]:** scrittura atomica per record, validazione schema in import, limite per dimensione di PNG/import, rifiuto di prototipi/script/html in campi testuali, niente URL arbitrari auto-aperti; link sorgente ricostruito da `videoId` validato e timestamp. Cancellazione irreversibile confermata. Metadati personali e label sono sotto controllo dell'utente. Nessun upload automatico.

**Backup [F]:** export in file locale versionato (manifest JSON con record e immagini correlate; formato esatto e limiti definire dopo prova di interoperabilità), import con deduplica per `id` e policy esplicita su conflitti. Non promettere persistenza assoluta in presenza di rimozione dell'estensione o pulizia dati. Gestire `QuotaExceededError` senza perdere record esistenti.

**Performance storage [H]:** soglia di avviso impostabile in termini di spazio stimato, non quota garantita. Caching thumbnail e immagini 1024 px solo al momento del salvataggio; evitare di mantenere tutti i canvas in RAM.

## 13. UX: flussi, errori e accessibilità

**Ingresso [F]:** icona VoiceCrystal nella toolbar. In pagina un pulsante discreto può aprire il pannello e fornire istruzioni, ma l'avvio della cattura avviene dalla action. UI con quattro schermate principali:

1. **Idle:** «Cristallizza la voce», spiegazione che si analizza l'audio della scheda solo dopo click, nessuna registrazione salvata.
2. **Listening / Waiting:** tempo di voce utile, livello qualità, «in attesa di parlato», interrompi. Mai inventare saturazione 100%.
3. **Revealed:** cristallo 3D, sei caratteristiche con etichette leggibili, metodo di arresto, qualità, salva/scarta, esporta PNG.
4. **Vault / Compare:** griglia miniature, filtri, selezione A/B, affinità acustica e differenze parametriche, confronto side-by-side.

**Errori espliciti:** nessuna voce, troppa musica, cambio di video, seeking, playback rate diverso da 1×, accesso negato, impossibile mantenere audio, GPU non disponibile, memoria piena, import incompatibile. Per errori di cattura ripristinare audio della scheda in ogni `finally` e chiudere lo stream. Nessun risultato valido deve essere mostrato quando mancano descrittori obbligatori.

**Accessibilità [F]:** contrasto testuale, tastiera, stato leggibile da screen reader, `prefers-reduced-motion`, navigazione senza WebGL dove possibile, colori non unica codifica dei parametri. Nessuna interfaccia che confonda affinità acustica con giudizio sulla persona.

## 14. Sicurezza, privacy e failure modes

- **Origini non fidate:** titolo, metadata e URL provenienti dalla pagina non devono poter eseguire HTML/JS nell'estensione.
- **Permessi minimali:** host limitato, niente `<all_urls>`, niente rete esterna per codice, VAD/WASM bundled. Se una dipendenza richiede eval/remote code, sostituirla.
- **Privacy:** flusso audio in RAM e durata limitata; nessun log PCM, stream ID, token o contenuti del parlato; log diagnostici locali disattivati in produzione, salvo consenso esplicito.
- **No biometric inference:** etichette manuali consentite, nessuna funzione automatica `identifySpeaker()`.
- **DoS locale:** rate limit messaggi interni, limiti coda DSP, limiti su geometria e import, non bloccare UI.
- **Service worker termination:** recupero della sessione tramite offscreen, non stato globale volatile; nessuna cattura invisibile dopo stop o chiusura tab.
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

- Parsing/normalizzazione: edge values, clipping, `NaN`/null, precisione 0,01, roundtrip seed.
- DSP PCM: fixture equivalenti producono seed identici con stesso estrattore, configurazione e runtime; tests per 44,1/48 kHz, resampling, stereo, overflow coda.
- Convergenza: mai prima del minimo, mai senza coverage, tre finestre consecutive richieste, timeout e motivi d'uscita preservati.
- Comparator: identità, simmetria, boundedness, distanza agli estremi, pesi, incompatibilità versioni; property-based testing.
- Crystal Core: due chiamate identiche -> vertex/index arrays bit-identici; `geometryHash` stabile; input vicino alle soglie; geometria senza NaN, coordinate finite, budget poligoni.
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
| 0 | Revisione avversariale + rischio legale | [G0] rischio accettato o percorso alternativo definito |
| 1 | PoC Chrome audio bypass + test lifecycle | La cattura non compromette il player; errori governati |
| 2 | DSP offline e dataset | [G1] report quantitativo + mapping/calibrazioni espliciti |
| 3 | Crystal core puro + renderer | [G2] geometria riproducibile e differenze visive motivate |
| 4 | Side Panel + Vault + Comparator | Test integrazione e persistenza superati |
| 5 | Hardening e distribuzione | Accessibilità, privacy, performance, policy e packaging verificati |

### Condizioni esplicite di NO-GO

- Impossibilità di garantire audio pass-through o stop pulito in Chrome reale.
- Dipendenza inderogabile da acquisizione remota o bypass dei vincoli di piattaforma.
- Seed che cambiano in modo sostanziale per perturbazioni innocue (gain, codec, piccole variazioni temporali) senza che ciò venga misurato e spiegato.
- Impossibilità di distinguere parlato utile da musica al livello minimo richiesto dalla promessa di prodotto.
- Mapping congelato senza dataset o metrica presentata come probabilità biometrica.
- Violazioni di condizioni applicabili/policy non risolte per il canale di distribuzione previsto.

## 17. Mandato all'agente di REVISIONE AVVERSARIALE (eseguire prima del coding)

> **RUOLO:** agisci come revisore ostile ma costruttivo, con competenze in Chrome MV3, Web Audio, DSP, geometria procedurale, privacy e UX. La tua missione è trovare come e perché VoiceCrystal fallirebbe in produzione. Non scrivere ancora il prodotto. Non dare per implementate o provate funzionalità soltanto perché sono specificate.

### Controlli obbligatori

**Architettura Chrome**: user gesture `tabCapture`, `getMediaStreamId` monouso e scadenza, permessi, offscreen document singleton e motivi, rischio `AUDIO_PLAYBACK` timeout, AudioWorklet e worker, service worker dormiente, interazione Side Panel, capture di una sola tab, navigazioni SPA, conflitti con YouTube, fullscreen, ads, Chrome min version.

**DSP e scientificità**: VAD su musica, rumore, tonalità, voci multiple; errori YIN pitch octave doubling; impossibilità di inferire HNR affidabile su miscele; correlazioni tra descrittori; clip duration; segnali stereo fuori fase; sample rate; perturbazioni codec; tempi video; rumore ambiente; overfitting alla calibrazione.

**Matematica**: definizione completa delle feature; convergenza falsa/ritardata; gestione delle osservazioni mancanti; confronto di versioni; pesi normalizzati; 0–100 bounded; discontinuità del mapping discreto; seed collision; arrotondamento e hash.

**Grafica**: mesh degeneri/non-manifold, auto-intersezioni, crescita esplosiva delle facce, differenza fra determinismo mesh e rendering, risorse GPU, perdita WebGL, interpretabilità delle differenze.

**Persistenza/privacy**: proprietà del dato locale, XSS da title/import, eccesso quota, backup malformato, migrazioni future, sanitizzazione URL, assenza PCM in log e storage, trattamento di dati potenzialmente riferibili a persone.

**Prodotto e distribuzione**: utilità dopo la prima cristallizzazione, costo cognitivo, compatibilità tra interfaccia in-player e gesto autorizzante, promesse scientifiche eccessive, policy YouTube/Chrome Web Store, fallback legittimi.

### Formato obbligatorio dell'output di revisione

1. **Executive verdict:** `GO / CONDITIONAL GO / NO-GO`, motivato con non più di 10 righe.
2. **Registro dei rilievi** ordinato per severità: `ID, severità (BLOCKER/CRITICAL/HIGH/MEDIUM/LOW), punto della specifica, scenario che rompe, riproduzione o prova teorica, impatto, correzione minima, test che impedisce la regressione, stato evidenza (verificato/da verificare)`.
3. **Dieci scenari avversariali prioritari**: casi reali di utilizzo che mostrano come il sistema fallirebbe, con trigger e expected behavior desiderato.
4. **Contraddizioni/ambiguità non risolte**: indicare cosa manca per iniziare a scrivere codice senza assumere nuove regole.
5. **Contromisure minime**: proporre correzioni con il minore impatto possibile su costi, performance e semplicità.
6. **Test plan corretto**: fixture, dataset, metriche, verifica manuale in Chrome e criteri di accettazione falsificabili.
7. **Risk matrix** con probabilità/gravità qualitative; dipendenze esterne; riduzione del rischio residuo.
8. **Decisioni richieste al product owner**, solo quelle che non possono essere scelte tecnicamente in sicurezza.
9. **Spec delta**: elenco puntuale delle modifiche suggerite, non una riscrittura dispersiva.
10. **Piano esecutivo post-approvazione:** backlog incrementale in issue indipendenti, ciascuna con DoD e test, priorità alle PoC e ai test automatizzati.

### Regole della revisione

- Tratta tutti i target `[H]` come ipotesi, non risultati.
- Distingui limiti strutturali da difetti correggibili.
- Se una raccomandazione richiede AI/ML pesante o backend, confrontala con il semplice ridimensionamento del requisito.
- Non proporre cambi architetturali costosi se il problema si risolve riducendo una promessa di prodotto.
- Ogni rilievo BLOCKER/CRITICAL deve contenere una prova o un test proposto che possa falsificarlo.
- Se un'API non è verificata, dichiara `needs current-doc verification` e usa preferibilmente documentazione ufficiale.
- **Non iniziare a implementare finché non è disponibile il report avversariale.**

## 18. Decision register e aspetti volutamente non congelati

| Codice | Stato | Decisione | Perché |
|---|---|---|---|
| ADR-01 | [F] | Chrome MV3, `tabCapture` → offscreen → DSP | Cattura separata dal player YouTube |
| ADR-02 | [F] | Click toolbar per start | Gesto utente verificabile con API Chrome |
| ADR-03 | [F] | Audio solo in memoria, niente raw persistente | Privacy e semplicità |
| ADR-04 | [F] | Six-vector, mapping versionata | Archivio e confronto coerenti |
| ADR-05 | [F] | Mesh pura, renderer separato | Test deterministici realistici |
| ADR-06 | [F] | Affinità euclidea pesata | Interpretabilità e boundedness |
| ADR-07 | [F] | IndexedDB e Blob immagini | Local-first, migrazioni e quota |
| ADR-08 | [H] | 8 / 18 / 45 s e `c_t<=0.02` | Valori di partenza, da testare |
| ADR-09 | [H] | Pesi 1/6 per affinità | Baseline neutra prima di calibrazione |
| ADR-10 | [G] | Legale/distribuzione e validazione DSP | Rischi non risolvibili con sola programmazione |
| ADR-11 | [P] | Diarizzazione, mesh affinity, overlay | Evitare complessità prematura |

## 19. Riferimenti ufficiali da ricontrollare in revisione

Riferimenti consultati al 9 novembre 2026, **non sostituiscono i test in Chrome reale né una consulenza legale**:

- Chrome tabCapture API: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Chrome audio recording/tab capture example: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Chrome offscreen documents: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Chrome Side Panel: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome MV3 CSP: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- Chrome remotely hosted code: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- Chrome permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- MDN AudioWorkletProcessor process: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- YouTube Terms of Service: https://www.youtube.com/t/terms
- YouTube API Developer Policies (applicabilità da verificare): https://developers.google.com/youtube/terms/developer-policies

---

**Regola finale:** il successo di VoiceCrystal non dipende dalla possibilità di produrre un cristallo bello; dipende dalla possibilità di dimostrare che una variazione osservabile della voce provoca una variazione geometrica interpretabile e riproducibile, con limiti esplicitati. Se questo fallisce, il progetto deve rimanere un generatore artistico dichiarato come tale, non essere presentato come sistema di riconoscimento vocale.
