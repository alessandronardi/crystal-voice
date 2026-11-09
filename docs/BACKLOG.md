# Backlog VoiceCrystal

18 issue in 5 fasi. Ogni issue è indipendente nel suo perimetro, ha una Definition of Done (DoD) verificabile e i test che la dimostrano. Vale sempre anche la DoD globale di `AGENTS.md` §8.

**Ordine consigliato.** La fase 1 (Chrome) e le fasi 2–3 (nucleo puro) possono procedere in parallelo. Le issue di fase 4 e 5 restano bloccate fino alla chiusura di G0 (`docs/GATES.md`).

**Stime:** S ≤ 1 giorno, M 2–4 giorni, L 5+ giorni di lavoro di un agente con revisione umana. Sono ordini di grandezza, non impegni.

## Vista d'insieme

| Issue | Fase | Titolo | Dipende da | Stima | Gate |
|---|---|---|---|---|---|
| I-01 | 1 | Scheletro monorepo, build MV3, lint di purezza, CI | — | M | — |
| I-02 | 1 | PoC cattura scheda + pass-through + avvio | I-01 | M | G-PoC |
| I-03 | 1 | Watchdog, ciclo di vita, macchina di cattura | I-02 | M | G-PoC |
| I-17 | 1 | Sorgente microfono e pagina di permesso | I-01 | M | G-PoC |
| I-18 | 1 | Sorgente file locale | I-01, I-04 | S | G-PoC |
| I-04 | 2 | Fixture sintetiche + harness offline | I-01 | M | G1 |
| I-05 | 2 | Pitch YIN + VAD a confronto | I-04 | M | G1 |
| I-06 | 2 | Sei descrittori, confidenza, euristiche musica e più voci | I-05 | L | G1 |
| I-07 | 2 | Arresto split-half | I-06 | S | G1 |
| I-08 | 2 | Dataset umano + report G1 | I-06, I-17 | L | G1 |
| I-09 | 2 | Tabelle quantili `mapping-1` e tabella G del comparator | I-08 | S | G1 |
| I-10 | 3 | crystal-core a semispazi | I-01 | L | G2 |
| I-11 | 3 | renderer-three «vetrina» | I-10 | L | G2 |
| I-12 | 3 | renderer-svg «tavola cristallografica» | I-10 | M | G2 |
| I-13 | 4 | Side Panel: home, nucleazione, rivelazione, cartellino | I-03, I-07, I-11, I-12, **G0** | L | Release |
| I-14 | 4 | Vault, miniature, export/import | I-10, **G0** | M | Release |
| I-15 | 4 | Comparator a percentile, Collezione, Confronto | I-09, I-14, **G0** | M | Release |
| I-16 | 5 | Hardening, accessibilità, SBOM, pacchetto | tutte | M | Release |

---

## Fase 1 — PoC Chrome

### I-01 · Scheletro monorepo, build MV3, lint di purezza, CI

- **Riferimenti:** SPEC §4, §5; AGENTS.md §6; ADR-0001, ADR-0010.
- **Obiettivo:** repository che compila un'estensione caricabile e impone le regole di purezza.
- **Perimetro:** pnpm workspaces con i pacchetti di SPEC §4 (vuoti ma tipizzati); Vite multi-entry (service worker, content script, offscreen, worklet, worker, side panel, collection, permission); manifest v0.3; Tailwind locale; Vitest + fast-check; Playwright; `.nvmrc`; script dei comandi di AGENTS.md §6; CI (typecheck, lint, test, build).
- **Fuori perimetro:** qualunque logica audio o geometrica.
- **DoD:**
  - [ ] `pnpm build` produce `dist/extension/` caricabile in Chrome 120 e nella stabile corrente senza errori nel pannello estensioni.
  - [ ] Regola ESLint: nei pacchetti puri vietati `chrome`, `window`, `document`, `three`; in `crystal-core/src/geometry/` vietati `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log`.
  - [ ] Un test dimostra che la regola scatta (file di esempio volutamente non conforme in `tests/lint-fixtures/`).
  - [ ] CSP del manifest senza sorgenti remote; build fallisce se il bundle contiene `eval` o `new Function`.
  - [ ] `tests/e2e/README.md` documenta come caricare l'estensione in Playwright e se l'headless è supportato (verificato o «non verificato»).
- **Test:** CI verde; E2E minimo «l'estensione si carica e il service worker risponde a un ping».

### I-02 · PoC cattura scheda + pass-through + avvio

- **Riferimenti:** SPEC §5; ADR-0001, ADR-0002, ADR-0003; VC-02, VC-03, VC-19.
- **Obiettivo:** dimostrare in Chrome reale che la cattura non compromette il player.
- **Perimetro:** `action.onClicked` con `sidePanel.open()` sincrono; `ensureOffscreen()` con `USER_MEDIA`, `WORKERS`; `getMediaStreamId`; `getUserMedia` nell'offscreen; pass-through con `latencyHint: 'interactive'`; AudioWorklet che conta i campioni ricevuti (nessun DSP); stop pulito.
- **DoD:**
  - [ ] 30 avvii manuali consecutivi su un video di riferimento: pannello aperto, audio udibile, nessun doppio audio, stop ripristina l'audio normale.
  - [ ] Pausa di 60 s: offscreen vivo (verifica `chrome.runtime.getContexts`).
  - [ ] Ritardo aggiunto dal pass-through misurato con loopback e registrato (valore, metodo, hardware); obiettivo ≤ 45 ms [H].
  - [ ] Verificato se esiste un flag di Chrome che permette di automatizzare il gesto su `tabCapture`; esito scritto in `tests/e2e/README.md`.
  - [ ] Se l'automazione non è possibile: `tests/e2e/MANUAL_CHECKLIST.md` con i passi e gli esiti attesi.
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

- **Riferimenti:** SPEC §5, §9; ADR-0009.
- **Obiettivo:** analizzare un file scelto dall'utente con lo stesso DSP.
- **Perimetro:** `<input type="file">` nel pannello; `decodeAudioData`; scelta del punto di partenza; primi 120 s; PCM al `dsp-worker`; errori `FILE_DECODE_FAILED`, `FILE_TOO_LONG`.
- **DoD:**
  - [ ] Le fixture sintetiche di I-04 caricate come file producono lo stesso seed dell'harness Node (bit per bit, o differenza spiegata dal resampling e documentata).
  - [ ] Il contenuto del file non viene mai persistito; nel record resta solo il nome.
- **Test:** E2E con file di fixture; unit sulla validazione dei limiti.

## Fase 2 — DSP offline e calibrazione

### I-04 · Fixture sintetiche + harness offline

- **Riferimenti:** SPEC §15; `docs/BENCHMARK_PROTOCOL.md`; R16.
- **Obiettivo:** banco di prova riproducibile senza audio reale.
- **Perimetro:** `scripts/fixtures/` genera WAV (silenzio, toni, sweep, rumori, impulsi, clipping, controfase, voce sintetica con f0 noto, A+B, alternanza A/B, voce + musica sintetica a −6/−12/−18 dB, voce compressa 4:1) con seed fissi; harness `pnpm bench` che esegue `dsp-core` su ogni fixture e scrive JSON.
- **DoD:**
  - [ ] `pnpm fixtures` è deterministico (hash dei WAV stabile).
  - [ ] Ogni fixture ha un file `.meta.json` con parametri di generazione e valori attesi (es. f0 vero).
  - [ ] `pnpm bench` gira in CI in meno di 2 minuti [H].
- **Test:** hash delle fixture; smoke test dell'harness.

### I-05 · Pitch YIN + VAD a confronto

- **Riferimenti:** SPEC §7.1–§7.3; VC-11.
- **Perimetro:** mono-mix con test in controfase; resampling anti-alias a 16 kHz; YIN con confidenza; integrazione di WebRTC VAD (libfvad, WASM) e Silero VAD (ONNX) dietro la stessa interfaccia.
- **DoD:**
  - [ ] Errore mediano f0 ≤ 1% e errori d'ottava ≤ 2% sulle fixture con f0 noto, oppure valori misurati riportati e soglia rinegoziata in ADR.
  - [ ] Tabella comparativa dei due VAD: falsi positivi su musica, falsi negativi su voce sintetica, dimensione bundle, licenza, tempo per secondo di audio.
  - [ ] ADR con la scelta del VAD.
- **Test:** unit su fixture; benchmark registrato.

### I-06 · Sei descrittori, confidenza, euristiche musica e più voci

- **Riferimenti:** SPEC §7.2, §7.4, §7.5; ADR-0006, ADR-0014; VC-10–VC-13.
- **Perimetro:** formule `EXPERIMENTAL v0`; confidenza per parametro; warning `MIXED_AUDIO_UNCERTAIN`, `MULTI_SPEAKER_SUSPECTED`; `mapping-0-experimental`; seed interi half-even; `extractor-0-experimental`.
- **DoD:**
  - [ ] Invarianza: ±6 dB e 44,1/48 kHz → Δ ≤ 1 punto per parametro.
  - [ ] Silenzio, toni, rumore → nessun cristallo.
  - [ ] Voce + musica a −12 dB → `MIXED_AUDIO_UNCERTAIN` in almeno il 90% delle varianti [H], o valore misurato riportato.
  - [ ] Alternanza A/B → `MULTI_SPEAKER_SUSPECTED` in almeno il 90% delle varianti [H], o valore misurato.
  - [ ] Voce compressa 4:1 → Δp3 misurato e riportato (VC-10).
- **Test:** property test (nessun `NaN`, range, interi); fixture.

### I-07 · Arresto split-half

- **Riferimenti:** SPEC §8; ADR-0008; VC-07.
- **DoD:**
  - [ ] Mai `CONVERGED` prima di 8 s o senza copertura.
  - [ ] Fixture A+B: nessun `CONVERGED` a cavallo del cambio di voce.
  - [ ] Tutti i motivi d'uscita prodotti dalle fixture appropriate.
- **Test:** unit su fixture e su sequenze sintetiche di descrittori.

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

- **Riferimenti:** SPEC §10; ADR-0005, ADR-0010; `packages/crystal-core/CLAUDE.md`.
- **Perimetro:** intersezione di semispazi; forme ammesse; cammino continuo di `p1`; terminazioni; secondari da dimensione 0; inclusioni; quantizzazione; PRNG per dominio; SHA-256; `geometryVersion = habit-1`; seed dorati.
- **DoD:**
  - [ ] 1.000 seed dorati: hash identici in Node, Chrome, Firefox.
  - [ ] Property test: convessità, Eulero, winding, coordinate finite, budget triangoli.
  - [ ] Continuità: Δ di 100 unità → 1 − IoU ≤ 0,03 [H] su 10.000 coppie casuali, o valore misurato e soglia in ADR.
  - [ ] Catalogo visivo di 200 seed (tavole SVG) per la revisione estetica G2.
- **Test:** unit, property, golden.

### I-11 · renderer-three «vetrina»

- **Riferimenti:** SPEC §10; ADR-0012, ADR-0014.
- **DoD:**
  - [ ] Materiale, ambiente procedurale, luce, ombra, piatto girevole, economy; versione di Three.js fissata e funzioni usate verificate su quella release.
  - [ ] Tratti velati resi in modo riconoscibile.
  - [ ] `webglcontextlost` → ripiego sulla tavola SVG senza crash.
  - [ ] 100 cicli monta/smonta senza crescita di memoria GPU.
  - [ ] Tempo di primo frame e frame time p50/p90/p95 misurati su hardware di riferimento documentato.
- **Test:** screenshot di riferimento con tolleranza; test di dispose.

### I-12 · renderer-svg «tavola cristallografica»

- **Riferimenti:** SPEC §10; ADR-0013.
- **DoD:**
  - [ ] Spigoli visibili e nascosti corretti sui seed dorati (verifica visiva + test sul conteggio).
  - [ ] SVG byte-identico fra esecuzioni e fra Node e browser.
  - [ ] SVG valido, con `<title>` e `<desc>` per l'accessibilità.

## Fase 4 — Prodotto (bloccata fino a G0)

### I-13 · Side Panel: home, nucleazione, rivelazione, cartellino

- **Riferimenti:** SPEC §6.2, §13; ADR-0011, ADR-0014.
- **DoD:**
  - [ ] Tutte le schermate e gli stati di SPEC §13, compresi errori espliciti e avviso più voci.
  - [ ] Germe in crescita da `provisionalSeed`, etichettato «provvisorio».
  - [ ] Cartellino e legenda viva con misure grezze e percentili.
  - [ ] Navigazione completa da tastiera; stati annunciati via `aria-live`; `prefers-reduced-motion` rispettato; contrasto AA.
  - [ ] Stringhe in `ui/strings.it.ts`.
- **Test:** Playwright sulle schermate; axe-core senza violazioni serie.

### I-14 · Vault, miniature, export/import

- **Riferimenti:** SPEC §12; VC-18, VC-20.
- **DoD:**
  - [ ] Schema v1 con migrazioni testate (da v1 a v1 vuota, struttura pronta per v2).
  - [ ] Import ostile rifiutato: prototipi, HTML, stringhe enormi, file > 20 MB, versioni sconosciute.
  - [ ] `QuotaExceededError` simulato: nessun record esistente perso.
  - [ ] 1.000 record sotto 50 MB [H]; `geometryHash` verificato all'apertura.
  - [ ] Avviso dati personali all'export se presenti `speakerLabel`.
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
