# CLAUDE.md — VoiceCrystal

@AGENTS.md

Quanto sopra vale integralmente. Qui ci sono solo le istruzioni specifiche per Claude Code.

## Avvio di sessione

1. Leggi `docs/STATUS.md`: dice fase, issue attiva e prossimo passo.
2. Se l'utente non indica una issue, proponi la prima issue sbloccata di `docs/BACKLOG.md` e chiedi conferma prima di scrivere codice.
3. Non leggere `docs/SPEC_v0.3.md` per intero: cerca con Grep le sezioni citate dalla issue (es. `## 8.`, `ADR-0008`). La specifica è lunga quasi 800 righe.

## Modo di lavoro

- **Plan mode** per ogni issue che tocca più di due file o un contratto in `packages/contracts`. Presenta il piano e attendi approvazione.
- **Lista dei task** (TodoWrite/TaskCreate) per ogni issue: un task per voce della Definition of Done, più «aggiornare STATUS e CHANGELOG».
- Esegui i comandi di verifica dopo ogni modifica significativa, non solo alla fine.
- Tieni le modifiche nel perimetro della issue. Miglioramenti fuori perimetro: una riga in `docs/STATUS.md` alla voce «Proposte».

## Subagenti e comandi del progetto

- `.claude/agents/adversarial-reviewer.md`: revisore indipendente per gate e PR critiche. Usalo **sempre** prima di dichiarare superato un gate, e per PR che toccano cattura audio, watchdog, determinismo o storage. Non ha scritto il codice: passagli la issue, il diff e la sezione di specifica, non le tue conclusioni.
- `/gate-check <G-PoC|G1|G2|G0|release>`: esegue la checklist del gate da `docs/GATES.md` e produce il verbale.
- `/new-adr <titolo>`: crea un ADR numerato dal template, stato `Proposto`.
- `/session-end`: aggiorna `docs/STATUS.md` e `CHANGELOG.md` e riassume cosa resta.

## Test in Chrome reale: cosa puoi e non puoi verificare

- L'ambiente di Claude Code spesso non ha un display né Chrome con l'estensione caricata. In quel caso `pnpm test:e2e` **non è stato eseguito**: scrivilo così nella PR e nello STATUS, con il motivo. Mai «presumibilmente funziona».
- Le estensioni in Playwright richiedono un contesto persistente con `--load-extension`. Il supporto in modalità headless dipende dal canale Chromium: verificare in I-01 e documentare in `tests/e2e/README.md`.
- Il click sull'icona della toolbar (gesto utente per `tabCapture`) può non essere automatizzabile. I-02 deve verificare se un flag di test di Chrome lo consente (`needs current-doc verification`); se no, la verifica è una checklist manuale in `tests/e2e/MANUAL_CHECKLIST.md`, eseguita da un umano e registrata nel verbale di gate.
- Tutto ciò che sta nei pacchetti puri si verifica in Node: lì i test devono essere completi.

## Errori tipici da evitare in questo progetto

- Mettere un `await` prima di `chrome.sidePanel.open()` in `action.onClicked`: perde il gesto utente.
- Aggiungere `AUDIO_PLAYBACK` ai motivi dell'offscreen «per sicurezza»: chiude il documento dopo 30 s di silenzio.
- Salvare stato di sessione in variabili globali del service worker: Chrome lo termina.
- Usare `Math.sin` o `Math.cos` nel percorso dei vertici di `crystal-core`: rompe l'hash fra motori JS.
- Arrotondare il seed con `Math.round(x * 100) / 100`: il seed è un intero, half-even.
- Presentare l'affinità euclidea come numero principale: la UI mostra il percentile di vicinanza.
- Generare fixture con audio reale scaricato: solo segnali sintetici da script.
- Usare `innerHTML` con titoli YouTube o dati importati.

## Git

- Lavora su un branch `issue/I-xx-breve-descrizione`, mai su `main`.
- Commit piccoli in Conventional Commits, in inglese.
- Fai commit, push o PR solo se l'utente lo chiede.

## Fine sessione

Prima di chiudere, sempre: aggiorna `docs/STATUS.md` (fatto, non fatto, evidenze, prossimo passo, blocchi) e la sezione Unreleased di `CHANGELOG.md`. Se hai lasciato test rossi o lavoro parziale, scrivilo in cima allo STATUS.
