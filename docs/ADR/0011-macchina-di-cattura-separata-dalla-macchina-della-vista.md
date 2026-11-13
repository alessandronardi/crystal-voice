# ADR-0011: Macchina di cattura separata dalla macchina della vista

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

La v0.2 mescolava stati di cattura e di interfaccia (`SAVED`, `COMPARING`) e lasciava stati terminali senza uscita (VC-14).

## Decisione

- Macchina di cattura nell'offscreen, autorevole, con stati terminali che tornano sempre a `IDLE`.
- Macchina della vista nella UI: `HOME`, `LIVE`, `REVEALED`, `SAVED`, `OUTCOME`, `COLLECTION`, `COMPARING`.
- Entrambe implementate come tabelle di transizione tipizzate e testate a modello.

## Conseguenze

Responsabilità chiare; la UI può essere riaperta senza perdere la cattura.

## Alternative scartate

Una sola macchina (v0.2).

## Verifica

Test a modello: ogni stato raggiunge `IDLE`; `stop()` da ogni stato (I-03).

## Emendamento proposto (2026-11-11, I-03): archi oltre la tabella di SPEC §6.1

- **Stato dell'emendamento:** accettato (tutti e tre gli archi).
  - `AUTHORIZING → INTERRUPTED`: **accettato** dal product owner il 2026-11-11, durante I-17. La sorgente microfono lo usa come percorso normale: pannello chiuso durante l'avvio, oppure porta del pannello non agganciata entro 3 s → `INTERRUPTED / USER_STOP` (rilievo M-4 della revisione di I-17).
  - I due archi da `FINALIZING`: **accettati** dal product owner il 2026-11-13, durante I-06b (decisione D-Z). Con l'analisi a fine sessione (ADR-0025) `FINALIZING` dura il calcolo finale, misurato in 1,0–1,1 s, al massimo 15 s. La cattura si chiude all'ingresso in `FINALIZING` (R8, rilievo C-1 della revisione di I-06b). Poi:
    - navigazione, heartbeat mancanti e chiusura della scheda **non** scartano il risultato, perché l'audio era già tutto raccolto;
    - «Interrompi» lo **scarta** (`FINALIZING → INTERRUPTED / USER_STOP`), perché lo chiede l'utente;
    - un errore di cattura dà `FINALIZING → ERROR`.
- **Conflitto:** SPEC §6 chiede che `stop()` sia «accettato da ogni stato», ma la tabella di SPEC §6.1 non ha un'uscita per lo stop da `AUTHORIZING` né da `FINALIZING`, e non ha errori di cattura in `FINALIZING`.
- **Proposta, già attuata in `extension/src/offscreen/capture-machine.ts`:**
  - `AUTHORIZING → INTERRUPTED` (stop dell'utente o un'interruzione durante l'avvio);
  - `FINALIZING → INTERRUPTED` (stop dell'utente);
  - `FINALIZING → ERROR` (errore di cattura durante la chiusura).
- **Effetto fino a I-06a:** `FINALIZING` durava un solo passo sincrono, perché non c'era ancora un analizzatore, quindi i due archi da `FINALIZING` non erano raggiungibili in pratica.
- **Deciso per I-06 (D-Z, 2026-11-13):** vedi sopra.
- Il test a modello (`extension/test/capture-machine.test.ts`) tiene separati gli archi di SPEC §6.1 da quelli di questo emendamento.

## Riferimenti

SPEC §6
