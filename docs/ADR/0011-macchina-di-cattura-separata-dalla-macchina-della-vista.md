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

- **Stato dell'emendamento:** Proposto, in attesa del product owner (rilievo M-3 della revisione avversariale di I-03).
- **Conflitto:** SPEC §6 chiede che `stop()` sia «accettato da ogni stato», ma la tabella di SPEC §6.1 non ha un'uscita per lo stop da `AUTHORIZING` né da `FINALIZING`, e non ha errori di cattura in `FINALIZING`.
- **Proposta, già attuata in `extension/src/offscreen/capture-machine.ts`:**
  - `AUTHORIZING → INTERRUPTED` (stop dell'utente o un'interruzione durante l'avvio);
  - `FINALIZING → INTERRUPTED` (stop dell'utente);
  - `FINALIZING → ERROR` (errore di cattura durante la chiusura).
- **Effetto oggi:** `FINALIZING` dura un solo passo sincrono, perché non c'è ancora un analizzatore, quindi i due archi da `FINALIZING` non sono raggiungibili in pratica.
- **Da decidere per I-06:** con il DSP, `FINALIZING` durerà quanto il calcolo finale. Resta da stabilire se uno stop in quel momento debba scartare un risultato potenzialmente pronto.
- Il test a modello (`extension/test/capture-machine.test.ts`) tiene separati gli archi di SPEC §6.1 da quelli di questo emendamento.

## Riferimenti

SPEC §6
