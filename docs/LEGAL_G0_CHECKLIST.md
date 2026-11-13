# G0 — Checklist per la valutazione legale e di distribuzione

> Questo documento raccoglie fatti e domande per la valutazione G0. Decisione del product owner D-AH (2026-11-13): la valutazione G0 si fa con un agente IA dedicato alla revisione legale, accettata dal product owner, **senza il parere firmato di un avvocato**. Non è un parere legale professionale: la responsabilità della distribuzione resta del product owner.

## 1. Fatti tecnici da presentare (verificabili nel codice)

- L'estensione analizza in tempo reale l'audio che l'utente sta già riproducendo nella propria scheda, dopo un click esplicito.
- Nessun download, salvataggio o ritrasmissione di audio o video. L'audio resta in memoria per al massimo 120 s e viene scartato.
- Si conservano solo sei numeri derivati, metadati (`videoId`, titolo, intervallo temporale stimato) e una miniatura generata.
- Nessuna interazione con pubblicità, DRM o controlli del player; nessuna API YouTube Data.
- Nessun backend, account o telemetria.
- Sorgente alternativa: microfono o file dell'utente.

## 2. Domande sui Termini di YouTube

Riferimento: [Termini di servizio di YouTube](https://www.youtube.com/terms), sezione «Autorizzazioni e limitazioni» (verificata il 9 novembre 2026).

1. L'analisi locale dell'audio riprodotto rientra nell'uso «personale, non commerciale» consentito, oppure nel divieto di «usare» i Contenuti salvo quanto espressamente autorizzato?
2. Un'estensione distribuita da terzi che abilita questa analisi espone lo sviluppatore a responsabilità diverse da quelle dell'utente?
3. Conservare `videoId`, titolo e intervallo temporale insieme ai descrittori è problematico?
4. Cambia qualcosa se l'estensione è gratuita, a pagamento o con donazioni?

## 3. Domande sul diritto applicabile (Italia/UE)

1. I descrittori acustici di una voce di terzi, associati a un'etichetta manuale con il nome della persona, sono dati personali? Si applica l'esenzione per attività personali o domestiche?
2. L'export e la condivisione di questi record da parte dell'utente cambia la valutazione?
3. Servono avvisi specifici nell'interfaccia o nell'informativa?
4. Diritto d'autore e diritti connessi: l'analisi transitoria in memoria e l'immagine derivata pongono problemi?
5. **Repository pubblico** (ADR-0027). Il codice sorgente è su un repository GitHub pubblico (`alessandronardi/crystal-voice`), da cui chiunque può costruire l'estensione; dal 2026-11-09 al 2026-11-13 la CI caricava anche la build come artefatto scaricabile per 7 giorni (passo poi tolto; 67 artefatti ancora non scaduti il 2026-11-13, cancellati lo stesso giorno su richiesta del product owner). Un repository di codice pubblico conta come distribuzione dell'estensione ai fini delle domande precedenti? Serve una licenza esplicita del codice, o conviene renderlo privato fino a G0?

## 4. Domande sulle policy del Chrome Web Store

1. La combinazione `tabCapture` + content script su `youtube.com` è compatibile con le policy correnti per estensioni che interagiscono con servizi di terzi?
2. Quali giustificazioni dei permessi servono nella scheda dello store?
3. Requisiti dell'informativa privacy e della dichiarazione d'uso dei dati.

## 4-bis. Licenze dei componenti di terzi nel pacchetto

1. **libfvad e `PATENTS` di WebRTC** (ADR-0023). Il pacchetto distribuito conterrà `fvad.wasm`, compilato dal progetto da libfvad (BSD-3-Clause). Il file `PATENTS` di WebRTC concede i brevetti di Google necessari a «this implementation of the WebRTC code package». La concessione decade per chi avvia una causa sostenendo che quel codice violi un brevetto.
   - **Stato:** il product owner ha accettato la clausola il 2026-11-12 (decisione D-S, `docs/STATUS.md`).
   - **Domanda aperta:** libfvad è un estratto di WebRTC fatto da terzi (`dpirch/libfvad`). La concessione su «questa implementazione» copre anche l'estratto e la sua compilazione in WebAssembly?
   - Il modulo contiene anche parti di musl (MIT), dlmalloc (pubblico dominio, CC0), compiler-rt (Apache-2.0 con eccezione LLVM) e del runtime di Emscripten (MIT / University of Illinois NCSA). Da I-06b le note sono in `THIRD_PARTY/emscripten/`, copiate dall'immagine Emscripten usata per la build, verificate dalla CI byte per byte, e distribuite nel pacchetto in `THIRD_PARTY/` insieme a `LICENSE` e `PATENTS` di libfvad.

## 5. Esiti possibili (da SPEC §3)

| Esito | Contenuto della distribuzione | Modifiche tecniche |
|---|---|---|
| (a) | Estensione con sorgenti scheda, microfono, file | Nessuna |
| (b) | Estensione con sole sorgenti microfono e file | Build con `VC_SOURCE_TAB=false`; rimozione di `tabCapture` e content script |
| (c) | Web app con il solo nucleo | Nuovo contenitore web; nucleo invariato |

## 6. Registro

| Data | Interlocutore | Domande trattate | Esito | Documento |
|---|---|---|---|---|
| 2026-11-13 | Agente IA di revisione legale, su incarico del product owner; accettata dal product owner senza avvocato (D-AH) | Tutte le domande del fascicolo (§4.1–§4.6) | «Superato con prescrizioni»: esito (a) condizionato da 10 azioni (G0-ACT-01…03, G0-TECH-01…03, G0-DOC-01…04), fallback (b). **G0 superato con prescrizioni** (D-AH); distribuzione bloccata fino al completamento delle prescrizioni. Eseguita: G0-ACT-01 (2026-11-13) | `docs/gates/G0-valutazione-2026-11-13.md` |
