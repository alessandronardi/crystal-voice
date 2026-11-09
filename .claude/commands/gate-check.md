---
description: Esegue la checklist di un gate e prepara il verbale (G-PoC, G1, G2, G0, release)
argument-hint: <G-PoC|G1|G2|G0|release>
---

Prepara il verbale del gate **$ARGUMENTS** per VoiceCrystal.

1. Leggi la sezione del gate in `docs/GATES.md` e `docs/STATUS.md`.
2. Per ogni voce della checklist cerca l'evidenza nel repository (test, report in `docs/reports/`, verbali precedenti, output di `pnpm test`, `pnpm test:golden`, `pnpm bench`). Esegui i comandi che puoi eseguire qui e annota l'output essenziale.
3. Segna ogni voce come «superata» (con evidenza), «non superata» o «non eseguita» (con chi la eseguirà). Mai «superata» senza evidenza.
4. Avvia il subagente `adversarial-reviewer` passandogli solo: il nome del gate, la checklist, l'elenco delle evidenze trovate e il commit corrente. Non passargli le tue valutazioni.
5. Scrivi il verbale in `docs/gates/$ARGUMENTS-<data odierna>.md` usando il modello in fondo a `docs/GATES.md`, con esito **proposto** e la sezione «Decisione del product owner» vuota.
6. Riassumi all'utente in poche righe: esito proposto, voci non superate, rilievi BLOCKER/CRITICAL. Ricorda che la decisione spetta al product owner.
