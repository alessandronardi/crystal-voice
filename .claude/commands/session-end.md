---
description: Chiude la sessione aggiornando STATUS e CHANGELOG
---

Chiudi la sessione di lavoro su VoiceCrystal.

1. Esegui `git status` e `git diff --stat` per ricostruire cosa è cambiato.
2. Esegui `pnpm typecheck`, `pnpm lint`, `pnpm test` se esistono; annota l'esito reale.
3. Aggiorna `docs/STATUS.md`:
   - data di aggiornamento;
   - issue attiva e avanzamento delle voci di DoD (fatto / non fatto);
   - in cima, in grassetto, test rossi o lavoro parziale lasciato;
   - tabella «Verificato / non verificato»;
   - prossimo passo concreto;
   - riga nel registro sessioni.
4. Aggiorna `CHANGELOG.md` nella sezione Unreleased con le modifiche visibili.
5. Se un rischio `VC-xx` ha cambiato stato, aggiorna `docs/RISK_REGISTER.md` con l'evidenza.
6. Riassumi all'utente in tre righe: fatto, non fatto, prossimo passo.
