# VoiceCrystal — Checklist e Registro di Valutazione Legale (Gate G0)

- **Versione di riferimento:** `0.3.0` (commit `032ac93` del 13 novembre 2026)
- **Data di compilazione:** 13 novembre 2026
- **Fascicolo d'origine:** `docs/gates/G0-fascicolo-legale.md`
- **Riferimenti ADR e Spec:** `docs/SPEC_v0.3.md` (§1–§3, §5, §12, §14), `docs/ADR/0021`, `0023`, `0025`, `0026`, `0027`, `AGENTS.md` §4
- **Stato del Gate G0:** **VALUTATO — APPROVATO CON CONDIZIONI (Esito A ottimizzato / Fallback Esito B)**

> **Nota del progetto (2026-11-13):** valutazione scritta da un agente IA di revisione legale. Decisione del product owner D-AH (2026-11-13): la valutazione G0 si fa con un agente IA dedicato alla revisione legale, accettata dal product owner, **senza il parere firmato di un avvocato**. Non è un parere legale professionale: la responsabilità della distribuzione resta del product owner.
>
> **Avvertenza metodologica:** Il presente documento registra la valutazione tecnico-legale e di conformità normativa (diritto UE/italiano, GDPR, AI Act, Diritto d'Autore, policy Chrome Web Store e licenze open-source) condotta sui fatti verificati al commit `032ac93`. Ha funzione di guida operativa e di conformità *Privacy & Legal by Design* per il progetto; non sostituisce la sottoscrizione formale di un avvocato iscritto all'albo.

---

## 1. Regola del Gate G0 (Vincolo ADR-0027)

1. L'interfaccia e il nucleo locale possono essere sviluppati prima della chiusura delle azioni correttive, ma **nessuna versione dell'estensione può essere distribuita** (niente pubblicazione sul Chrome Web Store, niente pacchetti `.zip`/`.crx` rilasciati, niente build scaricabili da terzi come artefatti CI) finché tutte le condizioni tecniche e documentali della **Sezione 4** non risultano completate (`[x]`).
2. Qualsiasi modifica futura ai permessi del browser (`extension/manifest.json`), alla Content Security Policy (`connect-src 'self'`), alla gestione in sola RAM dell'audio o ai dati salvati in `storage` invalida il presente Gate e richiede una nuova verifica.

---

## 2. Quadro Tecnico Verificato (Baseline `032ac93`)

| Ambito | Fatto tecnico verificato nel codice | Riferimento |
| :--- | :--- | :--- |
| **Architettura di rete** | Assenza totale di server, account, telemetria o pagamenti. CSP bloccata con `connect-src 'self'`. | `extension/manifest.json`, `AGENTS.md` §4 |
| **Permessi richiesti** | `tabCapture`, `offscreen`, `sidePanel`, `activeTab`, `storage`. | `extension/manifest.json`, `SPEC_v0.3.md` §5 |
| **Sorgenti audio** | 1) Scheda attiva (attivata solo da gesto esplicito sull'icona); 2) Microfono utente; 3) File audio locale. | `SPEC_v0.3.md` §1–§3 |
| **Trattamento dell'audio** | Copia solo in memoria RAM per la sessione (max 45 s di ascolto, max 120 s totali), poi scartata. Mai su disco, nei log o in rete. Passthrough invariato agli altoparlanti. | `ADR/0025`, `ADR/0026` |
| **Output dell'analisi** | 6 numeri interi («seme» per altezza, intonazione, dinamica, ruvidità, brillantezza, ritmo) + indicatori di qualità. Processo matematicamente non invertibile. | `SPEC_v0.3.md` §1 |
| **Interazione DOM** | Lettura del solo elemento standard `<video>` (posizione, pausa, velocità, muto, volume, eventi media standard). Nessuna elusione di annunci o DRM. | `ADR/0021` |
| **Dipendenze di terzi** | `libfvad` (BSD-3-Clause + `PATENTS` WebRTC), `musl` (MIT), `dlmalloc` (CC0/PD), `compiler-rt` (Apache-2.0 con eccezione LLVM), runtime Emscripten (MIT/NCSA). Previsti: `three.js` (MIT), font (SIL OFL). | `ADR/0023`, `THIRD_PARTY/` |

---

## 3. Questionario del Fascicolo e Valutazioni Consolidate

### 3.1 Termini di Servizio di YouTube

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.1.1** | L'analisi locale e transitoria dell'audio che l'utente sta già riproducendo rientra nell'uso «personale, non commerciale» consentito, o nel divieto di «usare» i contenuti salvo autorizzazione espressa? | **Valutazione:** Sul piano sostanziale, l'analisi spettrale/acustica volatile in RAM di un flusso già decodificato nel browser dell'utente (senza download, senza salvataggio della traccia e senza blocco delle inserzioni) è assimilabile a un equalizzatore o visualizzatore locale e rientra nella fruizione personale dell'utente. Tuttavia, i ToS di YouTube contengono una clausola ampia che vieta di «altrimenti utilizzare» i contenuti: Google può applicarla discrezionalmente in sede di revisione sul Chrome Web Store se l'estensione si presenta come strumento specifico per YouTube. |
| **4.1.2** | Un'estensione distribuita da terzi che abilita questa analisi espone lo sviluppatore a responsabilità diverse da quelle dell'utente? | **Valutazione:** Sì. Mentre l'utente finale non corre rischi concreti nell'uso locale, lo sviluppatore sottoscrive il *Chrome Web Store Developer Agreement*, che vieta estensioni che agevolino violazioni dei ToS di servizi di terzi (incluso YouTube). Il rischio concreto non è il contenzioso civile, ma il **rifiuto in fase di revisione o la rimozione (*takedown*) dallo Store**. |
| **4.1.3** | È problematico conservare sul computer dell'utente identificativo e titolo del video e intervallo di tempo, insieme ai sei numeri e alla miniatura generata? | **Valutazione:** **Sì, è critico e va rimosso.** Salvare strutturalmente `videoId`, titolo e intervallo temporale del video YouTube: (1) configura un'estrazione e indicizzazione sistematica di metadati YouTube; (2) lega in modo permanente i 6 parametri vocali all'identità della persona visibile nel video a quel minuto. **Prescrizione:** Non salvare `videoId`, URL o titolo del video in `storage` né nell'export JSON; consentire solo un'etichetta testuale libera opzionale inserita dall'utente. |
| **4.1.4** | Cambia qualcosa se l'estensione è gratuita, a pagamento o con donazioni? | **Valutazione:** Sì, in modo determinante. I ToS di YouTube vietano qualsiasi sfruttamento commerciale di funzionalità collegate al proprio player. **Prescrizione:** L'estensione deve essere distribuita in modo **100% gratuito**, senza acquisti in-app, paywall o inviti alla donazione dentro l'interfaccia dell'estensione. |

### 3.2 Diritto Italiano ed Europeo, Privacy (GDPR, AI Act, Diritto d'Autore)

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.2.1** | I sei numeri di una voce di terzi, associati a un'etichetta manuale con il nome della persona, sono dati personali? Vale l'esenzione per le attività personali o domestiche? | **Valutazione:** I 6 interi isolati sono parametri acustici anonimi, ma se associati al nome di una persona fisica diventano **dati personali** (Art. 4, n. 1, GDPR). Tuttavia: (1) poiché l'elaborazione è 100% locale e priva di trasmissione (`connect-src 'self'`), **lo sviluppatore non è né Titolare né Responsabile del trattamento** (Linee Guida EDPB 07/2020); (2) per l'utente che usa l'estensione sul proprio PC per diletto personale vale l'**esenzione domestica** (Art. 2, par. 2, lett. c, GDPR). |
| **4.2.2** | L'export e la condivisione di questi record da parte dell'utente cambia la valutazione? | **Valutazione:** Se l'utente diffonde pubblicamente online file contenenti nomi di terzi, l'utente stesso esce dall'esenzione domestica. Per **Privacy by Design (Art. 25 GDPR)**, si prescrive che l'export JSON **escluda di default i metadati testuali/etichette** (esportando solo i 6 interi, la versione dell'algoritmo e il profilo geometrico), oppure richieda un'azione esplicita con avviso prima di includere l'etichetta. |
| **4.2.3** | Gli stessi numeri ricavati dalla voce dell'utente richiedono avvisi o consenso particolari? Si resta fuori dai dati biometrici, dato che lo scopo non è identificare la persona? | **Valutazione:** **Si resta fuori dai dati biometrici (Art. 4, n. 14 e Art. 9 GDPR) e dai sistemi vietati/ad alto rischio dell'AI Act (Reg. UE 2024/1689).** Un vettore di soli 6 interi prosodici ha un'altissima collisione statistica, non permette tecnicamente l'identificazione univoca ($1:N$) né l'autenticazione ($1:1$) di una persona fisica e non classifica le emozioni. **Prescrizione:** Nel confronto tra due cristalli usare esclusivamente la dicitura **«Affinità acustica / geometrica»**, evitando qualsiasi riferimento a identità o compatibilità personale. |
| **4.2.4** | Servono avvisi nell'interfaccia o un'informativa privacy, anche se nessun dato lascia il computer? | **Valutazione:** Non c'è obbligo di informativa ex Art. 13 GDPR per l'estensione (perché lo sviluppatore non raccoglie dati), ma **il Chrome Web Store richiede obbligatoriamente una Privacy Policy pubblica** per le estensioni che usano `tabCapture`, `activeTab` e il microfono. È inoltre necessario un disclaimer chiaro nella UI sul carattere sperimentale, artistico e non biometrico dello strumento. |
| **4.2.5** | Diritto d'autore e diritti connessi: l'analisi transitoria in memoria e l'immagine derivata pongono problemi? | **Valutazione:** **Nessun problema.** (1) La copia temporanea in RAM (max 45–120 s) è coperta dall'eccezione obbligatoria per gli atti di riproduzione temporanea privi di rilievo economico proprio (**Art. 5, par. 1, Direttiva 2001/29/CE** e **Art. 68-bis L. 633/1941**); (2) i 6 numeri interi e il cristallo 3D procedurale non contengono frammenti del fonogramma e non costituiscono opera derivata né riproduzione ai sensi del diritto d'autore. |

### 3.3 Chrome Web Store (CWS)

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.3.1** | La combinazione di `tabCapture` e di un content script su `youtube.com` è compatibile con le policy correnti per le estensioni che interagiscono con servizi di terzi? | **Valutazione:** Dichiarare staticamente `"matches": ["https://www.youtube.com/*"]` insieme a `tabCapture` espone a un alto rischio di rigetto automatico/manuale sul CWS per sospetto *stream-ripping* da YouTube. **Prescrizione tecnica:** Rimuovere l'host permission statica su `youtube.com` e utilizzare l'iniezione on-demand tramite `activeTab` + `scripting` sull'elemento standard `<video>` della scheda attiva al clic dell'utente, presentando l'estensione sullo Store come analizzatore acustico generico per qualunque scheda audio/video HTML5 senza citare il marchio YouTube. |
| **4.3.2** | Quali giustificazioni dei permessi servono nella scheda dello store? | **Valutazione:** Occorre fornire giustificazioni granulari per *Single Purpose*, `tabCapture`, `offscreen`, `sidePanel`, `activeTab` (ed eventuale `scripting`) e `storage`, evidenziando l'assenza di salvataggio audio e il blocco CSP `connect-src 'self'`. I testi approvati sono riportati nella **Sezione 5.2**. |
| **4.3.3** | Quali sono i requisiti di informativa privacy e dichiarazione d'uso dei dati per un'estensione senza server? | **Valutazione:** Pubblicare il file `PRIVACY.md` (vedi **Sezione 5.3**) a un URL pubblico (repository GitHub / GitHub Pages), inserirlo nella Developer Dashboard del CWS e compilare il modulo *Data Usage* dichiarando che l'estensione **non raccoglie, non conserva su server esterni e non trasmette alcun dato utente**. |

### 3.4 Licenze e Brevetti

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.4.1** | La concessione di brevetti del file `PATENTS` di WebRTC («this implementation») copre anche l'estratto `libfvad` fatto da terzi e la sua compilazione in WebAssembly? | **Valutazione:** **Sì.** La clausola `PATENTS` di WebRTC copre l'uso, la compilazione e la redistribuzione del codice dell'implementazione WebRTC; compilare in WebAssembly il modulo C estratto senza alterarne la natura algoritmica rientra nella concessione, e il rischio brevettuale per un progetto non commerciale sul VAD classico di WebRTC è trascurabile. Includere sempre sia `BSD-3-Clause` sia il file `PATENTS` in `THIRD_PARTY/`. |
| **4.4.2** | Distribuire i testi di licenza in `THIRD_PARTY/` basta agli obblighi di MIT, BSD-3-Clause, Apache-2.0 e NCSA? | **Valutazione:** **Sì, con due verifiche:** (1) per **Apache-2.0 (`compiler-rt`)**, ai sensi della Sezione 4(d), verificare se il pacchetto sorgente LLVM contiene un file `NOTICE` e, in caso affermativo, includerlo in `THIRD_PARTY/`; (2) rendere visibili o richiamabili i testi di `THIRD_PARTY/` anche dall'interfaccia utente dell'estensione (link «Licenze Open Source» nel Side Panel). |

### 3.5 Repository Pubblico e Artefatti CI

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.5.1** | Un repository di codice pubblico, da cui chiunque può costruire l'estensione, conta come distribuzione ai fini delle domande 4.1–4.3, anche prima della pubblicazione sullo store? | **Valutazione:** Il solo codice sorgente su GitHub non attiva le policy del Chrome Web Store, ma costituisce distribuzione del codice ai fini delle licenze di terze parti. Al contrario, **le build compilate e scaricabili dagli artefatti della CI costituiscono distribuzione diretta dell'estensione a terzi**. |
| **4.5.2** | Il repository non ha una licenza del codice: va scelta adesso, o conviene renderlo privato fino al parere? | **Valutazione:** **Scegliere e aggiungere subito il file `LICENSE` nella radice del repository.** Si raccomanda la licenza **MIT** (o **Apache-2.0**), pienamente compatibile con tutte le dipendenze in `THIRD_PARTY/`. Non è necessario rendere privato il repository una volta aggiunto il file `LICENSE` e rimossi gli artefatti CI. |
| **4.5.3** | Dal 9 al 13 novembre 2026 le build sono state scaricabili come artefatti della CI. Ha conseguenze? Conviene cancellare subito i 67 artefatti non ancora scaduti? | **Valutazione:** **Sì, vanno cancellati immediatamente.** Conservare i 67 artefatti scaricabili viola la decisione di progetto del 13 novembre 2026 (`ADR/0027`) e distribuisce build prive delle informative e delle modifiche di conformità del Gate G0. |

### 3.6 Raccolta del Dataset di Calibrazione (15 Persone Adulte)

| # | Quesito | Valutazione e Prescrizione Operativa |
| :--- | :--- | :--- |
| **4.6.1** | Che cosa deve contenere il modulo di consenso: finalità, durata della conservazione, diritto di cancellazione, titolare del trattamento? | **Valutazione:** Poiché la voce registrata è un dato personale (Art. 4, n. 1, GDPR), lo sviluppatore agisce per questa specifica raccolta come **Titolare del Trattamento**. Il modulo (vedi template in **Sezione 5.4**) deve indicare: identità e contatto del Titolare, finalità esclusiva di calibrazione matematica per VoiceCrystal (escludendo voice cloning e biometria), base giuridica del consenso (Art. 6, par. 1, lett. a, GDPR), conservazione locale riservata, durata massima (**90 giorni**), diritto di revoca e cancellazione immediata. |
| **4.6.2** | Servono altre misure, per esempio pseudonimizzazione o valutazione d'impatto? | **Valutazione:** **Pseudonimizzazione obbligatoria; DPIA non necessaria.** Nominare i file audio solo con codici casuali (`SPK_01`...`SPK_15`), conservare i file audio in una cartella locale cifrata fuori dal repository e custodire separatamente l'elenco di associazione nome-codice fino alla distruzione degli audio. Non serve la DPIA (Art. 35 GDPR) trattandosi di 15 volontari adulti, senza dati biometrici ex Art. 9 né trattamento su larga scala. |
| **4.6.3** | Valori ricavati dalle registrazioni, come le tabelle di calibrazione, possono restare nel repository pubblico anche dopo la cancellazione delle registrazioni? | **Valutazione:** **Sì.** I quantili, le soglie statistiche e le tuple di 6 numeri interi privi di legame con i file audio cancellati sono **dati anonimizzati** (Considerando 26 GDPR) non riconducibili all'identità dei parlanti e possono restare permanentemente nel repository pubblico. |

---

## 4. Condizioni Obbligatorie per il Superamento Operativo del Gate G0

Prima di qualsiasi distribuzione o invio al Chrome Web Store devono essere completate le seguenti azioni:

### 4.1 Azioni Immediate sul Repository
- [x] **G0-ACT-01 (Artefatti CI)** — eseguita il 2026-11-13: 67 artefatti cancellati, ne restano 0 (registrato dal progetto): Cancellare immediatamente tutti i 67 artefatti di build ancora presenti su GitHub Actions (`gh api repos/alessandronardi/crystal-voice/actions/artifacts --paginate -q '.artifacts[].id' | xargs -I {} gh api -X DELETE repos/alessandronardi/crystal-voice/actions/artifacts/{}`).
- [x] **G0-ACT-02 (Licenza Codice)** — eseguita il 2026-11-14: file `LICENSE` MIT nella radice (registrato dal progetto): Aggiungere il file `LICENSE` (licenza **MIT**) nella radice del repository.
- [x] **G0-ACT-03 (Verifica `THIRD_PARTY/`)** — eseguita il 2026-11-14: `THIRD_PARTY/libfvad/PATENTS` presente; nessun file `NOTICE` in `system/lib/compiler-rt` di Emscripten 6.0.13 (la versione della build di `fvad.wasm`) né in `compiler-rt` di LLVM, elenchi dei file letti da GitHub: niente da aggiungere (registrato dal progetto): Verificare la presenza del file `PATENTS` di WebRTC per `libfvad` e dell'eventuale file `NOTICE` di LLVM per `compiler-rt` dentro `THIRD_PARTY/`.

### 4.2 Modifiche Tecniche e di Specifica (Esito A Ottimizzato)
- [ ] **G0-TECH-01 (Rimozione Metadati YouTube da Storage/Export):** Aggiornare `docs/SPEC_v0.3.md` (§12) e il codice affinché l'archivio locale (`storage`) e l'export JSON **non salvino mai `videoId`, URL o titolo del video YouTube**, conservando solo i 6 interi, la versione dell'algoritmo, la miniatura 3D generata e un'etichetta testuale opzionale inserita dall'utente.
- [ ] **G0-TECH-02 (Minimizzazione Export JSON):** Fare in modo che l'export JSON condivisibile dall'utente ometta di default l'etichetta testuale (o richieda un opt-in esplicito con avviso).
- [ ] **G0-TECH-03 (Disaccoppiamento da `youtube.com` per CWS):** Rimuovere preferibilmente `"matches": ["https://www.youtube.com/*"]` dai `content_scripts` statici di `extension/manifest.json`, sostituendolo con l'iniezione on-demand tramite `activeTab` + `scripting` su qualsiasi elemento `<video>` HTML5 al clic dell'utente (e non menzionando il marchio YouTube nella scheda dello Store).

### 4.3 Documentazione, UI e Dataset
- [x] **G0-DOC-01 (Disclaimer UI)** — eseguita con I-13a (PR crystal-voice#18, `739fb03`): testo §5.1 verbatim nella Home, verificato da `tests/unit/g0-notice.test.ts`, e link ai file di `THIRD_PARTY/` (registrato dal progetto): Inserire nel Side Panel dell'estensione l'avviso sintetico sulla natura 100% locale, artistica e non biometrica dell'analisi (testo in §5.1) e il link ai file in `THIRD_PARTY/`.
- [ ] **G0-DOC-02 (Terminologia Confronto):** Assicurarsi che nella UI il confronto fra cristalli sia denominato esclusivamente «Affinità acustica / geometrica» e mai come riconoscimento o verifica della persona.
- [x] **G0-DOC-03 (Privacy Policy Pubblica)** — eseguita il 2026-11-14: `PRIVACY.md` con il testo §5.3 verbatim; una frase sullo storage è da correggere prima della distribuzione (`docs/STATUS.md`, «Proposte») (registrato dal progetto): Aggiungere `PRIVACY.md` nel repository (testo in §5.3) per il collegamento nella scheda del Chrome Web Store.
- [ ] **G0-DOC-04 (Consenso Calibrazione):** Raccogliere la firma del modulo di consenso informato (§5.4) per ciascuno dei 15 volontari prima di registrare i campioni di calibrazione e cancellare gli audio entro 90 giorni.

---

## 5. Testi Approvati e Template Operativi

### 5.1 Testo Avviso Interfaccia (Side Panel / Onboarding)

> **Elaborazione 100% Locale e Sperimentale.** VoiceCrystal trasforma 6 parametri acustici della voce in un cristallo 3D decorativo. L'audio viene analizzato esclusivamente nella memoria RAM del tuo computer per pochi secondi e immediatamente scartato: nessun audio o dato viene mai salvato su disco o inviato in rete. Il cristallo e l'affinità acustica hanno valore puramente artistico e non costituiscono misura biometrica, analisi delle emozioni o identificazione della persona.

### 5.2 Giustificazioni dei Permessi per il Chrome Web Store

- **Single Purpose Description:**
  > *Generates procedural 3D geometric crystals from real-time acoustic features of speech via microphone, local audio files, or active tab playback, operating 100% locally in the browser with zero network transmission.*
- **`tabCapture` Justification:**
  > *Triggered strictly upon explicit user click on the extension action icon to perform real-time, in-memory acoustic feature extraction (pitch, intonation, dynamics, roughness, brilliance, rhythm) for generating a 3D procedural geometric shape. The captured audio is immediately routed back to the user's speakers unaltered, kept only in a volatile RAM buffer (max 120s), and is never recorded, saved to disk, or transmitted over the network (`connect-src 'self'`).*
- **`offscreen` Justification:**
  > *Required by Manifest V3 to host the Web Audio API context and the local WebAssembly DSP module that compute acoustic metrics in real time from the transient audio stream.*
- **`sidePanel` Justification:**
  > *Displays the interactive 3D crystal canvas and controls in the browser's native side panel without altering or injecting UI overlays into host webpages.*
- **`activeTab` (and `scripting`) Justification:**
  > *Grants temporary access to the active tab strictly upon user click to read standard HTML5 `<video>` playback state (pause, seek, rate change) so the acoustic analysis pauses or resets cleanly during media navigation.*
- **`storage` Justification:**
  > *Stores session state and the user's local gallery of 6-integer geometric crystal seeds exclusively on the user's device. No external servers or cloud sync are used.*

### 5.3 Testo `PRIVACY.md` (Informativa Privacy Estensione)

```markdown
# Informativa sulla Privacy — VoiceCrystal

Ultimo aggiornamento: 13 novembre 2026

VoiceCrystal è un'estensione per browser open-source che genera cristalli 3D decorativi a partire da parametri acustici del parlato.

## 1. Nessuna raccolta o trasmissione di dati (Zero Data Collection)
VoiceCrystal opera esclusivamente in locale sul dispositivo dell'utente:
- Non utilizza server esterni, database remoti, account utente, sistemi di analisi (analytics) o telemetria.
- La Content Security Policy dell'estensione (`connect-src 'self'`) impedisce tecnicamente qualsiasi connessione di rete verso l'esterno.
- Lo sviluppatore non ha accesso ad alcun audio, file, cronologia di navigazione o cristallo generato dall'utente.

## 2. Gestione temporanea dell'audio
- L'audio proveniente dal microfono, da un file locale o dalla scheda attiva del browser (attivato esclusivamente su comando esplicito dell'utente) viene elaborato in tempo reale nella sola memoria volatile (RAM) per una durata massima di 120 secondi e poi immediatamente scartato.
- Nessun frammento audio viene mai salvato su disco o esportato.

## 3. Dati salvati in locale
- L'estensione utilizza lo spazio di archiviazione locale del browser (`chrome.storage`) esclusivamente per conservare lo stato della sessione e l'archivio personale dei cristalli dell'utente (composto dai 6 numeri interi del seme geometrico, versione dell'algoritmo, miniatura 3D ed eventuale etichetta inserita dall'utente).
- Tali dati risiedono unicamente sul computer dell'utente e possono essere cancellati in qualsiasi momento tramite l'interfaccia dell'estensione o disinstallando l'estensione.

## 4. Natura non biometrica
I 6 parametri acustici estratti (altezza, intonazione, dinamica, ruvidità, brillantezza, ritmo) hanno finalità esclusivamente estetica e sperimentale: non consentono l'identificazione univoca del parlante, non costituiscono dati biometrici ai sensi dell'Art. 9 del Regolamento UE 2016/679 (GDPR) e non effettuano riconoscimento delle emozioni.

## 5. Contatti
Repository ufficiale del progetto: https://github.com/alessandronardi/crystal-voice
```

### 5.4 Modulo di Informativa e Consenso per il Dataset di Calibrazione (15 Volontari)

```markdown
# Modulo di Informativa Privacy e Consenso — Calibrazione VoiceCrystal
(Ai sensi degli Artt. 6, 7 e 13 del Regolamento UE 2016/679 — GDPR)

**1. Titolare del Trattamento**
Alessandro Nardi — Contatto email: [INSERIRE EMAIL DEL TITOLARE]

**2. Finalità del trattamento e natura dei dati**
La registrazione di 4 brevi tracce vocali (tramite 2 microfoni) è raccolta esclusivamente a scopo di ricerca e calibrazione matematica delle soglie acustiche (altezza, intonazione, dinamica, ruvidità, brillantezza, ritmo) del progetto software open-source "VoiceCrystal".
Le registrazioni NON verranno utilizzate per addestrare sistemi di intelligenza artificiale generativa, clonazione vocale o sistemi di identificazione biometrica.

**3. Base giuridica**
Il trattamento si fonda sul consenso libero, specifico e informato del partecipante (Art. 6, par. 1, lett. a, GDPR).

**4. Modalità di conservazione, pseudonimizzazione e sicurezza**
- A ciascun partecipante viene assegnato un codice alfanumerico casuale (es. `SPK_XX`).
- I file audio originali saranno conservati esclusivamente in un archivio privato locale ad accesso riservato al solo Titolare e NON saranno mai caricati su GitHub, pubblicati online o ceduti a terzi.
- Nel repository pubblico del progetto confluiranno esclusivamente i valori numerici aggregati/anonimi di calibrazione (i 6 numeri interi e le statistiche di distribuzione), dai quali non è possibile ricostruire la voce né risalire all'identità del partecipante.

**5. Durata della conservazione**
I file audio originali e la tabella di corrispondenza tra nome e codice anonimo saranno conservati per il tempo strettamente necessario alle operazioni di calibrazione e verranno **cancellati definitivamente entro e non oltre 90 giorni** dalla data di sottoscrizione del presente modulo.

**6. Diritti dell'interessato**
Il partecipante ha il diritto di revocare il consenso in qualsiasi momento e di chiedere l'accesso o la cancellazione anticipata e immediata delle proprie registrazioni audio scrivendo all'indirizzo email del Titolare sopra indicato, nonché il diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).

---
**DICHIARAZIONE DI CONSENSO**
Il/La sottoscritto/a ___________________________________, letto e compreso quanto sopra,
[ ] ACCONSENTE alla registrazione dei campioni vocali e al loro utilizzo esclusivo per la calibrazione interna del progetto VoiceCrystal secondo i termini sopra indicati.

Luogo e data: ____________________   Firma: ___________________________
*(Codice tecnico assegnato dal Titolare: SPK____)*
```

---

## 6. Registro del Parere e Decisione Finale (Gate G0)

| Campo | Valore Registrato |
| :--- | :--- |
| **Data di registrazione** | 13 novembre 2026 |
| **Commit verificato** | `032ac93` (v0.3.0) |
| **Esito principale approvato** | **Esito (a) Condizionato** — Estensione con sorgenti scheda attiva, microfono e file locale, subordinata all'attuazione delle condizioni `G0-ACT-01..03`, `G0-TECH-01..03` e `G0-DOC-01..04`. |
| **Esito di fallback autorizzato** | **Esito (b)** — Estensione con sole sorgenti microfono e file locale (rimozione di `tabCapture` e dello script di pagina), già autorizzato senza ulteriore revisione legale qualora il Chrome Web Store rifiuti il permesso `tabCapture` in fase di review. |
| **Distribuzione economica** | **100% Gratuita** (nessun pagamento, abbonamento o donazione in-app). |
| **Licenza del codice scelta** | **MIT License** (file `LICENSE` nella radice del repository). |
| **Visibilità del repository** | **Pubblica**, a condizione che i 67 artefatti CI siano stati rimossi (`G0-ACT-01`) e il file `LICENSE` sia presente (`G0-ACT-02`). |
| **Stato Gate G0** | **SUPERATO CON PRESCRIZIONI** — Sblocco della distribuzione subordinato alla spunta di tutti gli item della Sezione 4. |