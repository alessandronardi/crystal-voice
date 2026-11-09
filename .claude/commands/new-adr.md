---
description: Crea un nuovo ADR numerato in stato Proposto
argument-hint: <titolo della decisione>
---

Crea un nuovo ADR per VoiceCrystal con titolo: **$ARGUMENTS**.

1. Trova il numero più alto in `docs/ADR/` e usa il successivo, a quattro cifre.
2. Copia `docs/ADR/0000-template.md` in `docs/ADR/<numero>-<slug-ascii>.md`.
3. Compila Contesto, Decisione, Conseguenze, Alternative, Verifica, Riferimenti con ciò che sai dalla conversazione e dal codice. Separa fatti verificati da ipotesi. Stato: **Proposto**. Data: oggi.
4. Se l'ADR modifica un requisito della specifica, elenca in Conseguenze le sezioni di `docs/SPEC_v0.3.md` da aggiornare dopo l'approvazione, ma non modificarle ora.
5. Aggiungi una riga in `docs/STATUS.md` alla voce «Blocchi» o «Proposte»: l'ADR attende la decisione del product owner.
