# ADR-0027: G0 obbligatorio prima della distribuzione, non prima dello sviluppo

- **Stato:** Accettato (2026-11-13, dal product owner; decisione D-AG)
- **Data:** 2026-11-13
- **Decisori:** product owner

## Contesto

- **Le regole fino a oggi:** `AGENTS.md` §3 e `docs/GATES.md` bloccano le fasi 4 e 5 finché G0 non è chiuso: nessuna issue di fase 4 si inizia prima.
- **Che cosa chiede G0:**
  - il parere documentato di un professionista qualificato sui Termini di YouTube, sul diritto applicabile e sulle policy del Chrome Web Store;
  - una valutazione privacy;
  - la scelta di un esito fra (a) estensione con entrambe le sorgenti, (b) estensione con la sola «La tua voce», (c) web app con il solo nucleo.
- **Lo stato di G0:** non avviato. I tempi del parere non dipendono dal progetto.
- **La richiesta:** il product owner vuole curare l'interfaccia (I-13) adesso. Il 2026-11-13 ha deciso che G0 blocchi la distribuzione, non lo sviluppo (D-AG, da confermare con l'accettazione di questo ADR).

**Fatti rilevanti** (verificati il 2026-11-13):
- sviluppare e provare l'estensione sul proprio PC non distribuisce nulla, e le domande di G0 riguardano la distribuzione e l'uso da parte di terzi;
- **il repository `alessandronardi/crystal-voice` è pubblico** (`gh repo view`): il codice sorgente è leggibile da chiunque, e chiunque può costruire l'estensione;
- **la CI carica la build dell'estensione come artefatto** (`extension`, `dist/extension/`, conservato 7 giorni; `.github/workflows/ci.yml`). In un repository pubblico l'artefatto è scaricabile da qualunque utente GitHub collegato. Nessun altro job lo usa.

Se un repository di codice pubblico conti come distribuzione è una domanda legale, non tecnica: va aggiunta a G0.

## Decisione

1. **Sviluppo permesso:** le issue di fase 4 e 5 si possono sviluppare, revisionare e unire a `main` prima di G0.
2. **Distribuzione bloccata finché G0 non è chiuso:**
   - nessuna pubblicazione sul Chrome Web Store o altrove;
   - nessun pacchetto distribuibile;
   - nessuna condivisione di build fuori dal PC del product owner e dalla CI del progetto;
   - nessun uso da parte di terzi.
3. **G0 resta obbligatorio per il gate Release** (`docs/GATES.md`). L'esito di G0 può togliere funzioni già sviluppate.
4. **Nessun agente di sviluppo esprime pareri legali**: gli agenti preparano materiali e domande. Aggiornamento del 2026-11-13 (D-AH): la valutazione G0 è poi stata affidata dal product owner a un agente IA di revisione legale, senza avvocato (`docs/GATES.md`).
5. **Le prove manuali** ancora aperte di I-03, I-07 e delle altre issue di fase 1–2 restano «TO DO non bloccante» per le issue di fase 4.
6. **La CI non carica più la build dell'estensione come artefatto:** si toglie il passo `upload-artifact` con `name: extension`. Restano i report di benchmark e il `.wasm` del job riproducibile, che non sono l'estensione.
7. **Una domanda nuova in `docs/LEGAL_G0_CHECKLIST.md`:** il repository pubblico del codice sorgente, e la sua licenza, contano come distribuzione dell'estensione? Va decisa la visibilità del repository fino a G0.
   - Rendere privato il repository è una decisione del product owner, fuori da questo ADR.
   - Va considerato che la CI su repository privati ha minuti limitati.

## Conseguenze

- **Positive:** l'interfaccia si cura in parallelo al parere legale; quando arriverà il parere, il lavoro sarà già pronto.
- **Negative:**
  - **lavoro a rischio:** con l'esito (b) le schermate e i testi della sorgente scheda andranno tolti; con l'esito (c) anche il pannello dell'estensione andrà adattato a una pagina web;
  - **niente prove con persone esterne:** nemmeno amici o tester, perché sarebbe distribuzione;
  - **la CI resta interna:** gli artefatti di build non si pubblicano, e il pacchetto per il Web Store (I-16) non si prepara per l'invio.
- **Specifica:** questo ADR modifica SPEC §3, che chiedeva G0 «prima di iniziare la fase 4 (e comunque prima di qualunque distribuzione)»: resta solo «prima di qualunque distribuzione». SPEC §3 ha una nota che rimanda qui.
- **Testi da aggiornare:**
  - `AGENTS.md` §3;
  - `docs/GATES.md` (titolo e testo di G0);
  - `docs/BACKLOG.md`, dove G0 resta come blocco della release, non dello sviluppo, per I-13, I-14 e I-15;
  - `docs/LEGAL_G0_CHECKLIST.md` (la domanda sul repository pubblico);
  - `.github/workflows/ci.yml` (niente artefatto dell'estensione);
  - `docs/STATUS.md`.

## Alternative scartate

- **Aspettare G0:** nessun rischio di lavoro buttato, ma l'interfaccia resta ferma per un tempo che non controlliamo.
- **Sviluppare solo le schermate di microfono e file:** riduce il rischio, ma il percorso principale del prodotto è la scheda, e quelle schermate sono per lo più comuni.

## Verifica

- **Ogni PR di fase 4 o 5** dichiara «non distribuibile prima di G0».
- **Al gate Release:** `docs/GATES.md` richiede G0 chiuso.
- **La CI** non pubblica artefatti dell'estensione.

## Riferimenti

- **Regole:** `AGENTS.md` §3, §10; `docs/GATES.md` G0 e Release.
- **G0:** `docs/LEGAL_G0_CHECKLIST.md`.
- **Backlog:** `docs/BACKLOG.md` I-13–I-16.
