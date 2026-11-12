# ADR-0022: Analisi dei file locali in un dsp-worker del pannello

- **Stato:** Accettato (2026-11-12, dal product owner, dopo le verifiche E2E e la revisione avversariale di I-18)
- **Data:** 2026-11-12
- **Decisori:** product owner

## Contesto

I-18 aggiunge la sorgente «file locale» (ADR-0009). Due punti di SPEC §5 [F] la descrivono:

- **punto 3:** l'offscreen document possiede il DSP worker;
- **punto 7:** il file si decodifica nella Side Panel con `<input type="file">` e `decodeAudioData`, e il PCM decodificato «entra nello stesso `dsp-worker` come se fosse uno stream, senza pass-through».

Letti insieme, il PCM dovrebbe passare dal pannello al worker che vive nell'offscreen.

**Fatti verificati sul codice (2026-11-12, `origin/main` `0b47e89`):**

- `extension/src/offscreen/dsp-worker.ts` è vuoto (`export {}`). L'offscreen non lo avvia, e l'AudioWorklet conta solo i campioni (`pcm-processor.ts`). Oggi nessun PCM raggiunge il DSP, da nessuna sorgente.
- `chrome.runtime.sendMessage` raggiunge tutti i contesti dell'estensione, service worker compreso (commento in `packages/contracts/src/internal.ts`). SPEC §9 vieta di trasmettere PCM al service worker o alla UI.
- La CSP delle pagine dell'estensione contiene `connect-src 'self'` (ADR-0015).
- Il resampler di `dsp-core` funziona solo su un buffer intero (`packages/dsp-core/src/resample.ts`). Il percorso a blocchi è rimandato a I-06.

**Non misurato, da documentazione o da ragionamento:**

- La messaggistica di `chrome.runtime` serializza in JSON e ha un limite di dimensione dei messaggi (64 MiB secondo la documentazione di Chrome). 120 s stereo a 48 kHz sono 11,5 milioni di campioni float32: come numeri JSON superano quel limite.
- La CSP blocca un `fetch` dell'offscreen verso un URL `blob:` creato dal pannello.

**Decisioni del product owner del 2026-11-12, all'avvio di I-18:**

- il DSP dei file gira in un worker del pannello;
- un'analisi da file conta come sessione ai fini di `CAPTURE_BUSY`, in entrambi i versi.

## Decisione

1. **Worker nel pannello.** Per ogni analisi il pannello avvia un `Worker` dedicato dallo stesso file del bundle, `dsp-worker.js` (`chrome.runtime.getURL`, `type: 'module'`). Gli trasferisce i `Float32Array` dei canali con la lista dei trasferibili, senza copia. Lo termina alla fine dell'analisi, comunque sia finita: risposta, errore, risposta illeggibile, invio fallito, stop, oppure nessuna risposta entro 60 s [H]. Il codice DSP è lo stesso `packages/dsp-core` che gira in Node e che girerà nel worker dell'offscreen. L'istanza è diversa.
2. **Il PCM non lascia il pannello.** Nessun PCM passa da `chrome.runtime`, dallo storage, dal service worker o dall'offscreen. Il worker restituisce al pannello solo statistiche e digest, mai campioni.
3. **«Come se fosse uno stream»** vale per il contratto, non per il trasporto. Il file produce la stessa `AnalysisSource` di SPEC §9 (`kind: 'file'`) e passerà dalle stesse funzioni di `dsp-core`. Fino a I-06, che porta il percorso a blocchi, il file si analizza a buffer intero, l'unica modalità che il resampler supporta.
4. **Una sessione per profilo.** Un'analisi da file è una sessione ai fini di `CAPTURE_BUSY` (SPEC §5), in entrambi i versi.
   - **Avvio:** il pannello chiede l'avvio con il `CAPTURE_START` di SPEC §9 (`source: 'file'`).
   - **Registrazione:** se non c'è un'altra sessione, il service worker scrive in `chrome.storage.session` lo stato di instradamento `{ sessionId, source: 'file' }`. Il pannello prosegue quando `activeSession` nomina la sua sessione; un rifiuto arriva in `lastStart`.
   - **Vita della sessione:** quando un nuovo avvio trova una sessione file registrata, il service worker manda `FILE_SESSION_PING { sessionId }` a tutti i contesti dell'estensione. Risponde con `FILE_SESSION_PONG` solo il pannello che la sta eseguendo. Nessuna risposta entro 1 s [H], o nessun destinatario, significa che il pannello non c'è più (chiuso a metà analisi): lo stato orfano viene pulito e l'avvio prosegue. Niente timer di sessione e niente stato nelle globali del service worker.
   - **Fine:** il pannello comunica la fine con un messaggio interno (`FILE_SESSION_END`). «Interrompi la cattura in corso» ferma anche un'analisi da file: il pannello riceve lo stesso `CAPTURE_STOP` e l'`OFFSCREEN_STOP` che segue.
   - **Perché non `documentId`:** la prima versione di questo ADR legava la sessione al `MessageSender.documentId` del pannello e la verificava con `chrome.runtime.getContexts({ documentIds })`. Misurato in Chromium 156 il 2026-11-12: per un messaggio dal pannello laterale `MessageSender` contiene `id`, `url` e `origin`, ma non `documentId`. `getContexts` elenca invece il pannello (`SIDE_PANEL`) con il suo `documentId`. Il pannello non ha modo di conoscere il proprio. Il meccanismo è cambiato in fase di implementazione; la decisione D2 (il file conta per `CAPTURE_BUSY`, senza timer né globali) resta.
5. **Nessun permesso nuovo**, CSP invariata. Il worker è uno script dell'estensione: `script-src 'self'`.

## Conseguenze

- **Positive:**
  - il PCM del file resta nel processo del pannello per la sola durata dell'analisi (R1);
  - nessun limite di dimensione dei messaggi e nessuna serializzazione;
  - il file non crea un offscreen, quindi niente `USER_MEDIA` senza media.
- **Negative:**
  - esistono due istanze possibili del worker: offscreen per scheda e microfono (quando I-06 lo avvierà), pannello per i file. I messaggi del worker devono restare indipendenti dal contesto che lo ospita;
  - un pannello chiuso interrompe l'analisi: comportamento voluto, come per il microfono;
  - un avvio mandato subito dopo la chiusura del pannello, mentre il documento non è ancora sparito (circa 415 ms dopo `Target.closeTarget` nell'E2E), riceve ancora `CAPTURE_BUSY`: il pannello risponde al ping. Un nuovo click poco dopo funziona;
  - un pannello col thread principale bloccato per più di 1 s verrebbe creduto chiuso, e un secondo avvio partirebbe. Il pannello non fa lavoro sincrono lungo: la decodifica è asincrona e il DSP sta nel worker;
  - il ping raggiunge tutti i contesti dell'estensione: porta solo un `sessionId`, nessun dato del file.
- **Versioni:** nessuna. Nessun record né semantica del DSP cambiano.
- **SPEC da aggiornare (ADR accettato il 2026-11-12; modifica di sola documentazione, non ancora fatta):**
  - §5 punto 3: «DSP worker» dell'offscreen per scheda e microfono;
  - §5 punto 7: worker dedicato del pannello, «stesso codice»;
  - §5, «Una cattura globale»: vale anche per i file; la vita della sessione si verifica con `FILE_SESSION_PING`.
- **ADR toccati:** ADR-0001 (il DSP worker non vive solo nell'offscreen); ADR-0009 (nota di attuazione sui file).

## Alternative scartate

- **PCM all'offscreen con `chrome.runtime`:** serializzazione JSON di milioni di campioni, limite di dimensione, consegna a tutti i contesti compreso il service worker (SPEC §9).
- **`BroadcastChannel` verso l'offscreen:** copia il PCM in ogni pagina dell'estensione in ascolto, Collezione compresa (SPEC §9: niente PCM alla UI).
- **URL `blob:` letto dall'offscreen:** bloccato da `connect-src 'self'` (ADR-0015). Allentare la CSP indebolirebbe R2.
- **IndexedDB o storage come tramite:** persisterebbe PCM (R1).
- **`SharedWorker` unico per offscreen e pannello:** realizzerebbe alla lettera «lo stesso dsp-worker», ma riscrive ADR-0001 anche per scheda e microfono, e il supporto nell'offscreen non è verificato. Da riconsiderare se servirà un solo worker per tutte le sorgenti.
- **File fuori da `CAPTURE_BUSY`:** più semplice, ma reinterpreta il [F] «una sola sessione per profilo». Il product owner ha scelto di applicarlo anche ai file.

## Verifica

- **E2E** `tests/e2e/file.spec.ts`:
  - il worker parte sotto la CSP attuale;
  - le fixture caricate come file danno nel pannello lo stesso PCM mono a 16 kHz, lo stesso `signalSummary` e la stessa traccia di pitch dell'harness Node, bit per bit o con una differenza documentata;
  - nessun worker resta vivo dopo l'analisi;
  - storage e IndexedDB senza nome del file né campioni;
  - `CAPTURE_BUSY` nei due versi;
  - un pannello chiuso a metà analisi non blocca un avvio successivo.
- **Unit** `extension/test/start-capture.test.ts`: sessione file viva (il pannello risponde), orfana (nessuna risposta, nessun destinatario, nessuna risposta entro 1 s), risposta per un'altra sessione.
- **Checklist manuale:** in Brave, pannello chiuso a metà analisi e doppio click (M26, M27).

**Esito (2026-11-12, Chromium 156 di Playwright, Windows 11, con finestra e headless):** `tests/e2e/file.spec.ts` superato, 17 test dopo la revisione avversariale.
- «Interrompi», o un `CAPTURE_STOP` da qualunque pannello, chiude la sessione subito, anche durante la decodifica (15–20 ms): il pannello smette di rispondere al ping e manda `FILE_SESSION_END`.
- Il worker parte sotto la CSP attuale.
- La parte aritmetica dell'analisi è identica bit per bit a Node su 32 fixture su 32, con gli stessi campioni decodificati.
- Storage e IndexedDB restano senza nome del file.
- `CAPTURE_BUSY` funziona nei due versi.
- Il pannello chiuso a metà decodifica non blocca l'avvio successivo.
- La memoria del pannello torna al valore di partenza dopo l'analisi.

Non verificato: che il worker sia terminato (i dedicated worker non sono target CDP di primo livello), Brave, Google Chrome.

## Riferimenti

SPEC §5 (punti 3, 7; «Una cattura globale»), §7.1, §9; ADR-0001, ADR-0009, ADR-0015; `docs/BACKLOG.md` I-18; `tests/e2e/README.md`, sezione «File locali»; `docs/BENCHMARK_PROTOCOL.md` §7 (misure del 2026-11-12).
