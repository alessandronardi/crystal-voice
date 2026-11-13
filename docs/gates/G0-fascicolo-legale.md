# VoiceCrystal — fascicolo per la valutazione legale (gate G0)

> **Questo documento non è un parere legale.** Raccoglie fatti verificati nel codice e domande per la valutazione G0, preparati con un assistente di programmazione. La valutazione è in `docs/gates/G0-valutazione-2026-11-13.md`. Decisione del product owner D-AH (2026-11-13): la valutazione G0 si fa con un agente IA dedicato alla revisione legale, accettata dal product owner, **senza il parere firmato di un avvocato**. Non è un parere legale professionale: la responsabilità della distribuzione resta del product owner.
>
> **Versione da condividere** (documento modificabile, esportabile in .docx o PDF): https://claude.ai/artifact/A2MqYm79hfP5amYztQ15Nd. Privata finché il product owner non la condivide.
>
> **Base dei fatti:** commit `032ac93` del 2026-11-13, più le modifiche documentali di ADR-0027. Versione dell'estensione 0.3.0 (`extension/manifest.json`).

## 1. Che cos'è VoiceCrystal

VoiceCrystal è un'estensione per Chrome che trasforma un tratto di parlato in un **cristallo 3D**: un oggetto decorativo, generato in modo riproducibile da sei misure acustiche della voce, cioè altezza, intonazione, dinamica, ruvidità, brillantezza e ritmo.

**Sorgenti audio:**
1. **una scheda di YouTube** che l'utente sta già guardando: l'audio di un video `/watch`, dopo un clic esplicito sull'icona dell'estensione;
2. **«La tua voce»**: il microfono dell'utente, oppure un file audio locale scelto dall'utente.

**Promessa del prodotto:** una rappresentazione artistica, dichiarata sperimentale. **Non è** un riconoscimento della persona, una misura biometrica, una classificazione delle emozioni o una «impronta vocale» (SPEC §1, §2; regola R3).

**Elaborazione:** tutto avviene sul computer dell'utente. Non c'è un server, un account, una telemetria o un servizio a pagamento.

## 2. Stato attuale

- **Fase:** sviluppo. Nessuna versione è pubblicata, sul Chrome Web Store o altrove. Nessun utente esterno.
- **Decisione del 2026-11-13** (ADR-0027): lo sviluppo dell'interfaccia prosegue prima del parere. **Nulla si distribuisce finché G0 non è chiuso**: nessuna pubblicazione, nessun pacchetto, nessuna build consegnata a terzi.
- **Repository del codice:** `github.com/alessandronardi/crystal-voice`, **pubblico**.
  - Il codice sorgente è leggibile da chiunque, e chiunque può costruirsi l'estensione.
  - **Il repository non contiene un file di licenza del codice del progetto.**
  - Dal 2026-11-09 (primo commit, `16cea26`) al 2026-11-13 ogni corsa della CI caricava anche la build dell'estensione come artefatto, conservato 7 giorni e scaricabile da qualunque utente GitHub collegato. Il passo è stato tolto con ADR-0027. Il 2026-11-13 risultavano ancora 67 artefatti non scaduti, creati fra il 2026-11-09 e il 2026-11-13; **lo stesso giorno il product owner li ha fatti cancellare tutti** (`gh api … DELETE`, 67 su 67; ne restano 0).

## 3. Fatti tecnici verificati

Ogni punto rimanda al file del repository dove si può verificare.

### 3.1 Permessi richiesti al browser

Fonte: `extension/manifest.json`.

| Permesso | A che cosa serve |
|---|---|
| `tabCapture` | Ricevere l'audio della scheda YouTube attiva, solo dopo il clic sull'icona (gesto dell'utente richiesto da Chrome) |
| `offscreen` | Un documento nascosto dell'estensione che tiene aperto l'audio e fa l'analisi |
| `sidePanel` | Il pannello laterale con l'interfaccia |
| `activeTab` | Accesso temporaneo alla scheda su cui l'utente ha cliccato |
| `storage` | Solo `chrome.storage.session`: lo stato della sessione in corso, cancellato alla chiusura del browser. In futuro (issue I-14) l'archivio dei cristalli in IndexedDB |

- **Content script:** su `https://www.youtube.com/*` (ADR-0021).
- **Content Security Policy:** `connect-src 'self'`. L'estensione non può contattare nessun server esterno (ADR-0015, regola R2).

### 3.2 Che cosa fa sulla pagina YouTube

Fonti: `extension/src/content/youtube-adapter.ts`, `player-monitor.ts`; regole R4 e R5.

- **Legge solo l'elemento standard `<video>`:**
  - `currentTime`, `paused`, `playbackRate`, `muted`, `volume`;
  - gli eventi standard dei media;
  - l'identificativo del video dall'indirizzo della pagina (`v=…`).
- **Non legge** classi, variabili o API interne di YouTube, e **non usa** la YouTube Data API.
- **Non altera, salta o blocca** pubblicità, DRM o controlli del player. Non scarica né salva audio o video.
- **Interrompe l'analisi** se l'utente salta nel video, cambia video o velocità, o se si sospetta una pubblicità o un cambio di sorgente. L'interfaccia dichiara che alcuni annunci possono non essere riconosciuti.

### 3.3 Che cosa succede all'audio

Fonti: ADR-0001, ADR-0025, ADR-0026; regola R1.

- **Tragitto:** l'audio della scheda torna agli altoparlanti dell'utente. Catturarlo lo silenzia, quindi l'estensione lo ripete una sola volta, senza modifiche. Una copia va in memoria per l'analisi.
- **Durata:** l'audio resta **solo nella RAM**, per la durata della sessione: al massimo 45 s di ascolto, 120 s in tutto, con un tetto tecnico di 125 s. Alla fine della sessione si scarta.
- **Mai:** nessun salvataggio su disco, nessun log, nessuna trasmissione.
- **Analisi:** è transitoria. Durante l'ascolto si ripete ogni secondo sull'audio raccolto, per decidere quando fermarsi.
- **Risultato:** sei numeri interi (il «seme») e alcuni indicatori di qualità.
- **Microfono:** si attiva solo dopo il permesso del browser e un pulsante; resta attivo al massimo per la sessione.
- **File locale:** si legge nel pannello, si analizza in memoria e non si salva.

### 3.4 Che cosa si conserva

**Oggi:** nulla oltre la sessione in corso (`chrome.storage.session`).

**Previsto** (issue I-14, SPEC §12, non ancora sviluppato), sul solo computer dell'utente:
- i sei numeri del seme e la versione dell'algoritmo;
- per la scheda: identificativo e titolo del video, e intervallo di tempo stimato;
- una miniatura generata dal cristallo, non un fotogramma del video;
- un'eventuale **etichetta scritta dall'utente** (per esempio un nome), mai attribuita in automatico (R3);
- un export in un file JSON, che l'utente può condividere di sua iniziativa.

**Confronto fra cristalli** (I-15): mostra un «percentile di vicinanza» acustica. È dichiarato come affinità del suono, non come giudizio sulla persona o identità.

### 3.5 Componenti di terzi nel pacchetto

Fonti: `THIRD_PARTY/`, ADR-0023, `docs/LEGAL_G0_CHECKLIST.md` §4-bis.

| Componente | Licenza | Nota |
|---|---|---|
| libfvad (estratto del VAD di WebRTC, `dpirch/libfvad`), compilato dal progetto in WebAssembly | BSD-3-Clause, con il file `PATENTS` di WebRTC | La concessione di brevetti riguarda «this implementation of the WebRTC code package» e decade per chi avvia cause brevettuali. Accettata dal product owner il 2026-11-12 (D-S) |
| musl, dlmalloc, compiler-rt, runtime di Emscripten (dentro il modulo WebAssembly) | MIT; pubblico dominio / CC0; Apache-2.0 con eccezione LLVM; MIT / NCSA | Testi distribuiti in `THIRD_PARTY/`, confrontati dalla CI con la fonte |
| three.js (previsto per la vetrina 3D nell'interfaccia) | MIT | Già usato nel pacchetto `renderer-three`, non ancora nell'estensione |
| Font dell'interfaccia (previsti) | OFL (SPEC §13) | Da scegliere |

## 4. Domande per la valutazione

### 4.1 Termini di YouTube

Riferimento: [Termini di servizio di YouTube](https://www.youtube.com/terms), sezione «Autorizzazioni e limitazioni». Link verificato dal progetto il 9 novembre 2026.

1. L'analisi locale e transitoria dell'audio che l'utente sta già riproducendo rientra nell'uso «personale, non commerciale» consentito? Oppure ricade nel divieto di «usare» i contenuti salvo quanto espressamente autorizzato?
2. Un'estensione distribuita da terzi che abilita questa analisi espone lo sviluppatore a responsabilità diverse da quelle dell'utente?
3. È problematico conservare sul computer dell'utente identificativo e titolo del video e intervallo di tempo, insieme ai sei numeri e alla miniatura generata?
4. Cambia qualcosa se l'estensione è gratuita, a pagamento o con donazioni?

### 4.2 Diritto applicabile (Italia / UE) e privacy

1. I sei numeri di una voce di terzi (per esempio di chi parla in un video), associati a un'etichetta manuale con il nome della persona, sono dati personali? Si applica l'esenzione per le attività personali o domestiche?
2. L'export e la condivisione di questi record da parte dell'utente cambia la valutazione?
3. Gli stessi numeri ricavati dalla **voce dell'utente** (microfono o file) richiedono avvisi o un consenso particolari? Si rimane fuori dai dati biometrici, visto che lo scopo non è identificare la persona?
4. Servono avvisi specifici nell'interfaccia, o un'informativa privacy, anche se nessun dato lascia il computer?
5. Diritto d'autore e diritti connessi: l'analisi transitoria in memoria e l'immagine derivata pongono problemi?

### 4.3 Chrome Web Store

1. La combinazione di `tabCapture` e di un content script su `youtube.com` è compatibile con le policy correnti per le estensioni che interagiscono con servizi di terzi?
2. Quali giustificazioni dei permessi servono nella scheda dello store?
3. Quali sono i requisiti dell'informativa privacy e della dichiarazione d'uso dei dati, per un'estensione senza server?

### 4.4 Licenze e brevetti

1. La concessione di brevetti del file `PATENTS` di WebRTC, «this implementation», copre anche l'estratto libfvad fatto da terzi e la sua compilazione in WebAssembly?
2. Distribuire nel pacchetto i testi di licenza in `THIRD_PARTY/` basta agli obblighi di MIT, BSD-3-Clause, Apache-2.0 e NCSA?

### 4.5 Repository pubblico (nuova, ADR-0027)

1. Un repository di codice pubblico, da cui chiunque può costruire l'estensione, conta come distribuzione ai fini delle domande 4.1–4.3, prima della pubblicazione sullo store?
2. Il repository non ha un file di licenza del codice del progetto. Serve sceglierne una adesso? Oppure conviene rendere il repository privato fino a G0?
3. Dal 2026-11-09 al 2026-11-13 le build dell'estensione sono state scaricabili come artefatti della CI (§2). Questo fatto ha conseguenze, anche ora che gli artefatti sono stati cancellati (13 novembre 2026)?

### 4.6 Raccolta di un piccolo dataset di voci (issue I-08, prossima)

Per calibrare le misure, il progetto prevede di registrare con consenso scritto **15 persone adulte**:
- 4 brevi letture o parlati per persona, con 2 microfoni;
- **registrazioni conservate fuori dal repository**, con accesso limitato;
- nel repository solo identificativi anonimi e numeri (`docs/BENCHMARK_PROTOCOL.md` §3).

Domande:
1. Che cosa deve contenere il modulo di consenso: finalità, durata della conservazione, diritto di cancellazione, titolare del trattamento?
2. Servono altre misure, per esempio la pseudonimizzazione o una valutazione d'impatto?
3. Valori ricavati dalle registrazioni, come le tabelle di calibrazione, possono restare nel repository pubblico dopo la cancellazione delle registrazioni?

## 5. Esiti possibili di G0

Fonte: SPEC §3, `docs/LEGAL_G0_CHECKLIST.md` §5.

| Esito | Che cosa si distribuisce | Modifiche tecniche |
|---|---|---|
| (a) | Estensione con sorgenti scheda, microfono e file | Nessuna |
| (b) | Estensione con sole sorgenti microfono e file | Build senza la sorgente scheda: via il permesso `tabCapture` e il content script di YouTube |
| (c) | Web app con il solo nucleo di analisi e disegno | Un nuovo contenitore web; il nucleo resta invariato |

**Che cosa chiede il progetto:**
- un **parere scritto** che risponda alle domande;
- l'**esito** consigliato fra (a), (b) e (c);
- le **condizioni**: testi dell'interfaccia, informativa, licenza del codice, visibilità del repository.

Il parere va registrato in `docs/LEGAL_G0_CHECKLIST.md` §6 e in `docs/STATUS.md`.

## 6. Documenti di riferimento nel repository

- `docs/SPEC_v0.3.md` §1–§3 (prodotto e vincolo legale), §5 (permessi), §12 (archivio), §14 (sicurezza e privacy);
- `docs/LEGAL_G0_CHECKLIST.md` (domande e registro);
- `docs/ADR/0021` (content script), `0023` (libfvad e `PATENTS`), `0025` e `0026` (audio in memoria), `0027` (G0 prima della distribuzione);
- `AGENTS.md` §4 (regole R1–R17: privacy, rete, YouTube, dati).
